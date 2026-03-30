import * as THREE from "three";
import type { Position, Trajectory, Waypoint } from "../core/types";
import type { MujocoState } from "./mujocoLoader";

export type AnimatorStatus = "idle" | "running" | "paused" | "done" | "error";

export interface AnimatorCallbacks {
  onStepStart?: (index: number, waypoint: Waypoint) => void;
  onStepComplete?: (index: number) => void;
  onStatusChange?: (status: AnimatorStatus) => void;
  onError?: (error: Error) => void;
}

const FRAMES_PER_MOVE = 90; // ~1.5s at 60fps
const FRAMES_PER_GRIPPER = 40;
const PHYSICS_SUBSTEPS = 5; // mj_step calls per frame
const NUM_ARM_JOINTS = 7;

// IK params
const IK_MAX_ITER = 300;
const IK_POS_TOL = 0.003;
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
  private frameId: number | null = null;
  private gripperActuatorIdx: number;
  private handBodyId: number;

  // Joint interpolation
  private startQpos: Float64Array | null = null;
  private targetQpos: Float64Array | null = null;
  // Locked arm qpos — maintained during gripper/wait steps to prevent drift
  private lockedArmQpos: Float64Array | null = null;
  // Home orientation matrix (3x3, row-major) — the desired EE orientation
  private homeOriMat: Float64Array;
  // IK goal marker (Three.js sphere, green)
  private ikGoalMarker: THREE.Mesh | null = null;

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

    // Show TCP debug point (red dot) at the current TCP position
    this.updateTcpDebugPoint();
  }

  loadTrajectory(trajectory: Trajectory): void {
    this.trajectory = trajectory;
    this.currentStep = 0;
    this.setStatus("idle");
  }

  play(): void {
    if (!this.trajectory || this.trajectory.waypoints.length === 0) return;
    if (this.status === "done") this.currentStep = 0;
    this.setStatus("running");
    this.prepareStep();
    this.tick();
  }

  pause(): void {
    this.setStatus("paused");
    this.cancelFrame();
  }

  reset(): void {
    this.setStatus("idle");
    this.currentStep = 0;
    this.cancelFrame();
  }

  getStatus(): AnimatorStatus { return this.status; }
  getCurrentStepIndex(): number { return this.currentStep; }

  private setStatus(s: AnimatorStatus): void {
    this.status = s;
    this.callbacks.onStatusChange?.(s);
  }

  private cancelFrame(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  /** Set a Three.js scene reference so we can add the IK goal marker. */
  setThreeScene(threeScene: THREE.Scene): void {
    const geo = new THREE.SphereGeometry(0.015, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.6 });
    this.ikGoalMarker = new THREE.Mesh(geo, mat);
    this.ikGoalMarker.visible = false;
    threeScene.add(this.ikGoalMarker);
  }

  private showIkGoal(pos: Position): void {
    if (this.ikGoalMarker) {
      this.ikGoalMarker.position.set(pos.x, pos.y, pos.z);
      this.ikGoalMarker.visible = true;
    }
  }

  private hideIkGoal(): void {
    if (this.ikGoalMarker) {
      this.ikGoalMarker.visible = false;
    }
  }

  /** Update the mocap body (red dot) to show current TCP position. */
  updateTcpDebugPoint(): void {
    const { data } = this.state;
    if (data.mocap_pos.length >= 3) {
      const [tx, ty, tz] = this.getTcpPos(data);
      data.mocap_pos[0] = tx;
      data.mocap_pos[1] = ty;
      data.mocap_pos[2] = tz;
    }
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
    const stepSize = 0.2;

    for (let iter = 0; iter < IK_MAX_ITER; iter++) {
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

    // Log final IK errors
    mj.mj_forward(model, data);
    const [ftx, fty, ftz] = this.getTcpPos(data);
    const fPosErr = Math.sqrt((target.x-ftx)**2 + (target.y-fty)**2 + (target.z-ftz)**2);
    const fOriErr = this.getOriCost(data);
    console.log(`[ik] pos_err: ${fPosErr.toFixed(4)}m, ori_err: ${fOriErr.toFixed(4)}`);

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

      // Solve IK for target
      this.targetQpos = this.solveIK(wp.position);

      // Show IK goal (green dot) and move mocap (red dot) to target
      this.showIkGoal(wp.position);
      if (data.mocap_pos.length >= 3) {
        data.mocap_pos[0] = wp.position.x;
        data.mocap_pos[1] = wp.position.y;
        data.mocap_pos[2] = wp.position.z;
      }

      this.totalFrames = FRAMES_PER_MOVE;
      this.framesRemaining = FRAMES_PER_MOVE;
    } else if (wp.gripper) {
      data.ctrl[this.gripperActuatorIdx] = wp.gripper === "open" ? 255 : 0;
      // Lock arm at current position during gripper action
      this.startQpos = null;
      this.targetQpos = null;
      this.lockCurrentArmQpos();
      this.totalFrames = FRAMES_PER_GRIPPER;
      this.framesRemaining = FRAMES_PER_GRIPPER;
    } else if (wp.wait !== undefined) {
      this.startQpos = null;
      this.targetQpos = null;
      this.lockCurrentArmQpos();
      this.totalFrames = Math.round(wp.wait * 60);
      this.framesRemaining = this.totalFrames;
    }
  }

  private lockCurrentArmQpos(): void {
    const { data } = this.state;
    this.lockedArmQpos = new Float64Array(NUM_ARM_JOINTS);
    for (let i = 0; i < NUM_ARM_JOINTS; i++) {
      this.lockedArmQpos[i] = data.qpos[i];
    }
  }

  private tick = (): void => {
    if (this.status !== "running" || !this.trajectory) return;
    const { mj, model, data } = this.state;

    // Interpolate arm qpos directly (kinematic control)
    if (this.startQpos && this.targetQpos) {
      const t = 1 - this.framesRemaining / this.totalFrames;
      const s = smoothstep(t);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        data.qpos[j] = this.startQpos[j] + (this.targetQpos[j] - this.startQpos[j]) * s;
        // Also update ctrl so actuators track (prevents drift after step)
        data.ctrl[j] = data.qpos[j];
      }
    }

    // Step physics (for object dynamics, gripper actuation)
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
      mj.mj_step(model, data);
      // Re-apply arm qpos after each substep (kinematic override)
      if (this.startQpos && this.targetQpos) {
        const t = 1 - this.framesRemaining / this.totalFrames;
        const s = smoothstep(t);
        for (let j = 0; j < NUM_ARM_JOINTS; j++) {
          data.qpos[j] = this.startQpos[j] + (this.targetQpos[j] - this.startQpos[j]) * s;
          data.ctrl[j] = data.qpos[j];
        }
      } else if (this.lockedArmQpos) {
        // During gripper/wait steps: hold arm in place
        for (let j = 0; j < NUM_ARM_JOINTS; j++) {
          data.qpos[j] = this.lockedArmQpos[j];
          data.ctrl[j] = this.lockedArmQpos[j];
        }
      }
    }

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

    this.frameId = requestAnimationFrame(this.tick);
  };
}

function smoothstep(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}
