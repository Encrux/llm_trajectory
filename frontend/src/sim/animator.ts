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
const IK_MAX_ITER = 100;
const IK_STEP_SIZE = 0.5;
const IK_TOL = 0.005;

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

  constructor(state: MujocoState, callbacks: AnimatorCallbacks = {}) {
    this.state = state;
    this.callbacks = callbacks;
    const { mj, model } = state;
    this.gripperActuatorIdx = model.nu - 1;
    this.handBodyId = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, "hand");

    // Debug: log body names and IDs to verify
    const data = state.data;
    console.log("[animator] handBodyId:", this.handBodyId);
    for (let i = 0; i < model.nbody; i++) {
      const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY.value, i) || "(unnamed)";
      console.log(`[animator] body ${i}: ${name}, pos: ${data.xpos[i*3].toFixed(3)}, ${data.xpos[i*3+1].toFixed(3)}, ${data.xpos[i*3+2].toFixed(3)}`);
    }
    for (let i = 0; i < Math.min(model.njnt, 15); i++) {
      const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_JOINT.value, i) || "(unnamed)";
      console.log(`[animator] joint ${i}: ${name}, qposadr: ${model.jnt_qposadr[i]}`);
    }
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

  /**
   * Numerical IK: iteratively adjust arm joints to move hand toward target.
   * Works entirely on a qpos copy — does NOT disturb the live sim until we restore.
   */
  private solveIK(target: Position): Float64Array {
    const { mj, model, data } = this.state;

    // Save full state
    const origQpos = new Float64Array(model.nq);
    for (let i = 0; i < model.nq; i++) origQpos[i] = data.qpos[i];

    const perturbDelta = 0.0001;
    const maxJointStep = 0.1; // max radians per iteration

    for (let iter = 0; iter < IK_MAX_ITER; iter++) {
      mj.mj_forward(model, data);

      const hx = data.xpos[this.handBodyId * 3 + 0];
      const hy = data.xpos[this.handBodyId * 3 + 1];
      const hz = data.xpos[this.handBodyId * 3 + 2];
      const dx = target.x - hx;
      const dy = target.y - hy;
      const dz = target.z - hz;
      const err = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (err < IK_TOL) break;

      // Compute full numerical Jacobian (3 x NUM_ARM_JOINTS)
      const Jx = new Float64Array(NUM_ARM_JOINTS);
      const Jy = new Float64Array(NUM_ARM_JOINTS);
      const Jz = new Float64Array(NUM_ARM_JOINTS);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        const saved = data.qpos[j];
        data.qpos[j] = saved + perturbDelta;
        mj.mj_forward(model, data);
        Jx[j] = (data.xpos[this.handBodyId * 3 + 0] - hx) / perturbDelta;
        Jy[j] = (data.xpos[this.handBodyId * 3 + 1] - hy) / perturbDelta;
        Jz[j] = (data.xpos[this.handBodyId * 3 + 2] - hz) / perturbDelta;
        data.qpos[j] = saved; // restore before next column
      }
      // Restore FK to unperturbed state
      mj.mj_forward(model, data);

      // dq = J^T * error (all joints computed, then applied together)
      const dq = new Float64Array(NUM_ARM_JOINTS);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        dq[j] = Jx[j] * dx + Jy[j] * dy + Jz[j] * dz;
      }

      // Limit max joint step to prevent divergence
      let maxAbs = 0;
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        maxAbs = Math.max(maxAbs, Math.abs(dq[j]));
      }
      const scale = maxAbs > maxJointStep ? maxJointStep / maxAbs : 1.0;

      // Apply step to all joints at once
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        data.qpos[j] += scale * dq[j];
        const lo = model.jnt_range[j * 2 + 0];
        const hi = model.jnt_range[j * 2 + 1];
        if (lo < hi) {
          data.qpos[j] = Math.max(lo, Math.min(hi, data.qpos[j]));
        }
      }
    }

    // Read result
    const result = new Float64Array(NUM_ARM_JOINTS);
    for (let i = 0; i < NUM_ARM_JOINTS; i++) result[i] = data.qpos[i];

    // Restore original state
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

      // Verify: check where the hand ends up with the IK solution
      const { mj, model } = this.state;
      const savedQ = new Float64Array(model.nq);
      for (let i = 0; i < model.nq; i++) savedQ[i] = data.qpos[i];
      for (let i = 0; i < NUM_ARM_JOINTS; i++) data.qpos[i] = this.targetQpos[i];
      mj.mj_forward(model, data);
      const hx = data.xpos[this.handBodyId * 3];
      const hy = data.xpos[this.handBodyId * 3 + 1];
      const hz = data.xpos[this.handBodyId * 3 + 2];
      console.log(`[ik] target: (${wp.position.x.toFixed(3)}, ${wp.position.y.toFixed(3)}, ${wp.position.z.toFixed(3)})`);
      console.log(`[ik] hand at IK solution: (${hx.toFixed(3)}, ${hy.toFixed(3)}, ${hz.toFixed(3)})`);
      console.log(`[ik] startQpos:`, [...this.startQpos].map(v => v.toFixed(3)));
      console.log(`[ik] targetQpos:`, [...this.targetQpos].map(v => v.toFixed(3)));
      for (let i = 0; i < model.nq; i++) data.qpos[i] = savedQ[i];
      mj.mj_forward(model, data);

      // Move mocap red dot to target
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
