import type { Position, Trajectory, Waypoint } from "../core/types";
import type { MujocoState } from "./mujocoLoader";

export type AnimatorStatus = "idle" | "running" | "paused" | "done" | "error";

export interface AnimatorCallbacks {
  onStepStart?: (index: number, waypoint: Waypoint) => void;
  onStepComplete?: (index: number) => void;
  onStatusChange?: (status: AnimatorStatus) => void;
  onError?: (error: Error) => void;
}

const FRAMES_PER_MOVE = 120; // ~2s at 60fps
const FRAMES_PER_GRIPPER = 45; // ~0.75s for gripper action
const NUM_ARM_JOINTS = 7;

// IK params
const IK_MAX_ITER = 500;
const IK_POS_TOL = 0.002;
const IK_ORI_TOL = 0.01;

// TCP offset: hand body origin → actual fingertip grasp point (meters, in hand-local Z)
// Adjust this to calibrate where the gripper centers on the target
const TCP_Z_OFFSET = 0.105;

// Orientation weight in IK — balances position vs orientation convergence
const ORI_WEIGHT = 1.0;

export class Animator {
  private state: MujocoState;
  private trajectory: Trajectory | null = null;
  private currentStep = 0;
  private framesRemaining = 0;
  private totalFrames = 0;
  private status: AnimatorStatus = "idle";
  private callbacks: AnimatorCallbacks;
  private gripperActuatorIdx: number;
  private handBodyId: number;

  // Joint interpolation
  private startQpos: Float64Array | null = null;
  private targetQpos: Float64Array | null = null;
  // Held arm position during non-move steps (gripper/wait)
  private heldQpos: Float64Array | null = null;
  // Track if gripper is closed (holding object) — affects move control strategy
  private gripperClosed = false;
  // Pre-computed IK solutions for all position waypoints
  private ikSolutions: Map<number, Float64Array> = new Map();
  // Home orientation matrix (3x3, row-major) — the desired EE orientation
  private homeOriMat: Float64Array;

  constructor(state: MujocoState, callbacks: AnimatorCallbacks = {}) {
    this.state = state;
    this.callbacks = callbacks;
    const { mj, model } = state;
    this.gripperActuatorIdx = model.nu - 1;
    this.handBodyId = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, "hand");

    // Save home orientation of the hand (desired EE orientation = face down)
    const data = state.data;
    mj.mj_forward(model, data);
    this.homeOriMat = new Float64Array(9);
    const mi = this.handBodyId * 9;
    for (let i = 0; i < 9; i++) {
      this.homeOriMat[i] = data.xmat[mi + i];
    }

  }

  loadTrajectory(trajectory: Trajectory): void {
    this.trajectory = trajectory;
    this.currentStep = 0;
    this.setStatus("idle");
  }

  async play(): Promise<void> {
    if (!this.trajectory || this.trajectory.waypoints.length === 0) return;
    if (this.status === "done") this.currentStep = 0;

    // Compute IK BEFORE setting status to running (prevents race with render loop)
    this.setStatus("idle");
    await this.precomputeIK();
    this.setStatus("running");
    this.prepareStep();
  }

  private async precomputeIK(): Promise<void> {
    if (!this.trajectory) return;
    this.ikSolutions.clear();
    const { data } = this.state;

    const origQpos = new Float64Array(this.state.model.nq);
    for (let i = 0; i < this.state.model.nq; i++) origQpos[i] = data.qpos[i];

    // Track the IK seed (each solve starts from previous solution)
    const ikSeed = new Float64Array(NUM_ARM_JOINTS);
    for (let j = 0; j < NUM_ARM_JOINTS; j++) ikSeed[j] = data.qpos[j];

    for (let i = 0; i < this.trajectory.waypoints.length; i++) {
      const wp = this.trajectory.waypoints[i];
      if (wp.position) {
        // Set seed for this solve
        for (let j = 0; j < NUM_ARM_JOINTS; j++) data.qpos[j] = ikSeed[j];
        const solution = this.solveIK(wp.position);
        this.ikSolutions.set(i, solution);
        // Update seed for next solve
        for (let j = 0; j < NUM_ARM_JOINTS; j++) ikSeed[j] = solution[j];

        // Restore original pose before yielding (so render loop sees stable robot)
        for (let i = 0; i < this.state.model.nq; i++) data.qpos[i] = origQpos[i];
        this.state.mj.mj_forward(this.state.model, data);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    console.log(`[animator] Pre-computed IK for ${this.ikSolutions.size} waypoints`);
  }

  pause(): void {
    this.setStatus("paused");
  }

  reset(): void {
    this.setStatus("idle");
    this.currentStep = 0;
  }

  getStatus(): AnimatorStatus { return this.status; }
  getCurrentStepIndex(): number { return this.currentStep; }

  private setStatus(s: AnimatorStatus): void {
    this.status = s;
    this.callbacks.onStatusChange?.(s);
  }



  /**
   * Get the TCP position (fingertip grasp point) from the hand body.
   * Applies TCP_Z_OFFSET along the hand's local Z axis.
   */
  private getTcpPos(data: any): [number, number, number] {
    const bi = this.handBodyId * 3;
    const mi = this.handBodyId * 9;
    // Hand local Z axis is the 3rd column of xmat (row-major: indices 2, 5, 8)
    const zx = data.xmat[mi + 2];
    const zy = data.xmat[mi + 5];
    const zz = data.xmat[mi + 8];
    return [
      data.xpos[bi + 0] + TCP_Z_OFFSET * zx,
      data.xpos[bi + 1] + TCP_Z_OFFSET * zy,
      data.xpos[bi + 2] + TCP_Z_OFFSET * zz,
    ];
  }

  /**
   * Scalar orientation cost: sum of squared differences between
   * current and home rotation matrix elements.
   * Returns sqrt(cost) as a single error magnitude.
   */
  private getOriCost(data: any): number {
    const mi = this.handBodyId * 9;
    let cost = 0;
    for (let i = 0; i < 9; i++) {
      const d = data.xmat[mi + i] - this.homeOriMat[i];
      cost += d * d;
    }
    return Math.sqrt(cost);
  }

  /**
   * 6-DOF IK: position (TCP) + orientation (home), all 7 joints free.
   */
  private solveIK(target: Position): Float64Array {
    const { mj, model, data } = this.state;

    const origQpos = new Float64Array(model.nq);
    for (let i = 0; i < model.nq; i++) origQpos[i] = data.qpos[i];

    const perturbDelta = 0.0001;

    for (let iter = 0; iter < IK_MAX_ITER; iter++) {
      // Adaptive step size: large initially, small later for precision
      const stepSize = iter < 150 ? 0.3 : iter < 250 ? 0.1 : 0.03;
      mj.mj_forward(model, data);

      // Compute combined cost: position + orientation
      const [tcpX, tcpY, tcpZ] = this.getTcpPos(data);
      const dx = target.x - tcpX;
      const dy = target.y - tcpY;
      const dz = target.z - tcpZ;
      const posErr = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const oriCost = this.getOriCost(data);
      const totalCost = 0.5 * (dx*dx + dy*dy + dz*dz) + ORI_WEIGHT * 0.5 * oriCost * oriCost;

      if (posErr < IK_POS_TOL && oriCost < IK_ORI_TOL) break;

      // Numerical gradient of total cost w.r.t. each joint
      const grad = new Float64Array(NUM_ARM_JOINTS);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        const saved = data.qpos[j];
        data.qpos[j] = saved + perturbDelta;
        mj.mj_forward(model, data);

        const [nx, ny, nz] = this.getTcpPos(data);
        const ndx = target.x - nx, ndy = target.y - ny, ndz = target.z - nz;
        const nOriCost = this.getOriCost(data);
        const nCost = 0.5 * (ndx*ndx + ndy*ndy + ndz*ndz) + ORI_WEIGHT * 0.5 * nOriCost * nOriCost;

        grad[j] = (nCost - totalCost) / perturbDelta;
        data.qpos[j] = saved;
      }

      // Gradient descent: q -= stepSize * grad
      // Normalize gradient to prevent huge steps
      let gradNorm = 0;
      for (let j = 0; j < NUM_ARM_JOINTS; j++) gradNorm += grad[j] * grad[j];
      gradNorm = Math.sqrt(gradNorm);
      const effectiveStep = gradNorm > 1.0 ? stepSize / gradNorm : stepSize;

      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        data.qpos[j] -= effectiveStep * grad[j];
        const lo = model.jnt_range[j * 2 + 0];
        const hi = model.jnt_range[j * 2 + 1];
        if (lo < hi) {
          data.qpos[j] = Math.max(lo, Math.min(hi, data.qpos[j]));
        }
      }
    }

    // Log final error
    mj.mj_forward(model, data);
    const [fx, fy, fz] = this.getTcpPos(data);
    const fErr = Math.sqrt((target.x-fx)**2 + (target.y-fy)**2 + (target.z-fz)**2);
    console.log(`[ik] pos_err: ${(fErr*1000).toFixed(1)}mm, ori_err: ${this.getOriCost(data).toFixed(4)}`);

    const result = new Float64Array(NUM_ARM_JOINTS);
    for (let i = 0; i < NUM_ARM_JOINTS; i++) result[i] = data.qpos[i];

    for (let i = 0; i < model.nq; i++) data.qpos[i] = origQpos[i];
    mj.mj_forward(model, data);

    return result;
  }

  private prepareStep(): void {
    if (!this.trajectory) return;
    const wp = this.trajectory.waypoints[this.currentStep];
    this.callbacks.onStepStart?.(this.currentStep, wp);
    const { data } = this.state;

    if (wp.position) {
      // Save current arm qpos as start
      this.startQpos = new Float64Array(NUM_ARM_JOINTS);
      for (let i = 0; i < NUM_ARM_JOINTS; i++) this.startQpos[i] = data.qpos[i];

      // Use pre-computed IK solution (no blocking solve during playback)
      this.targetQpos = this.ikSolutions.get(this.currentStep) || this.startQpos;

      console.log(`[move] step ${this.currentStep}, gripper ctrl=${data.ctrl[this.gripperActuatorIdx]}, finger qpos: ${data.qpos[7].toFixed(4)}, ${data.qpos[8].toFixed(4)}`);

      this.totalFrames = FRAMES_PER_MOVE;
      this.framesRemaining = FRAMES_PER_MOVE;
    } else if (wp.gripper) {
      data.ctrl[this.gripperActuatorIdx] = wp.gripper === "open" ? 255 : 0;
      this.gripperClosed = wp.gripper === "close";
      // Hold arm at current position
      this.startQpos = null;
      this.targetQpos = null;
      this.heldQpos = new Float64Array(NUM_ARM_JOINTS);
      for (let i = 0; i < NUM_ARM_JOINTS; i++) this.heldQpos[i] = data.qpos[i];
      this.totalFrames = FRAMES_PER_GRIPPER;
      this.framesRemaining = FRAMES_PER_GRIPPER;
    } else if (wp.wait !== undefined) {
      this.startQpos = null;
      this.targetQpos = null;
      this.heldQpos = new Float64Array(NUM_ARM_JOINTS);
      for (let i = 0; i < NUM_ARM_JOINTS; i++) this.heldQpos[i] = data.qpos[i];
      this.totalFrames = Math.round(wp.wait * 60);
      this.framesRemaining = this.totalFrames;
    }
  }

  /** Set arm actuator targets to hold current position and zero arm velocity. */
  private holdArm(): void {
    const { data } = this.state;
    for (let i = 0; i < NUM_ARM_JOINTS; i++) {
      data.ctrl[i] = data.qpos[i];
      data.qvel[i] = 0;
    }
  }

  /**
   * Called by the render loop each frame BEFORE mj_step.
   * Kinematically sets arm qpos + ctrl for precise positioning.
   */
  preStep(): void {
    if (this.status !== "running" || !this.trajectory) return;
    const { data } = this.state;

    if (this.startQpos && this.targetQpos) {
      const t = 1 - this.framesRemaining / this.totalFrames;
      const s = smoothstep(t);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        const val = this.startQpos[j] + (this.targetQpos[j] - this.startQpos[j]) * s;
        if (this.gripperClosed) {
          // Holding object: actuator-only (preserves contact physics)
          data.ctrl[j] = val;
        } else {
          // Not holding: kinematic (precise positioning)
          data.qpos[j] = val;
          data.ctrl[j] = val;
        }
      }
    } else if (this.heldQpos) {
      // Gripper/wait step: hold arm via ctrl
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        data.ctrl[j] = this.heldQpos[j];
      }
    }
  }

  /**
   * Called AFTER each mj_step substep.
   * No kinematic override — let physics handle contacts naturally.
   * preStep already set qpos+ctrl before the first substep.
   */
  postSubstep(): void {
    // intentionally empty — overriding qpos after mj_step breaks contact physics
  }

  /**
   * Called once per render frame AFTER all substeps. Advances waypoint timing.
   */
  postFrame(): void {
    if (this.status !== "running" || !this.trajectory) return;

    this.framesRemaining--;

    if (this.framesRemaining <= 0) {
      this.callbacks.onStepComplete?.(this.currentStep);
      this.currentStep++;
      if (this.currentStep >= this.trajectory.waypoints.length) {
        this.setStatus("done");
        return;
      }
      this.prepareStep();
    }
  }
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
