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
const IK_MAX_ITER = 100;
const IK_TOL = 0.005;

// TCP offset: hand body origin → actual fingertip grasp point (meters, in hand-local Z)
// Adjust this to calibrate where the gripper centers on the target
const TCP_Z_OFFSET = 0.105;

// Joints to lock at home values during IK (wrist joints — prevents EE rotation)
// Joint indices: 0=shoulder_pan, 1=shoulder_lift, 2=elbow, 3=wrist1, 4=wrist2, 5=wrist3, 6=wrist_roll
const LOCKED_JOINTS = [4, 5, 6]; // wrist joints locked to home orientation

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
  // Home joint values for locked wrist joints
  private homeQpos: Float64Array;
  // IK goal marker (Three.js sphere, green)
  private ikGoalMarker: THREE.Mesh | null = null;

  constructor(state: MujocoState, callbacks: AnimatorCallbacks = {}) {
    this.state = state;
    this.callbacks = callbacks;
    const { mj, model } = state;
    this.gripperActuatorIdx = model.nu - 1;
    this.handBodyId = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, "hand");

    // Save home joint values (for locking wrist joints)
    const data = state.data;
    mj.mj_forward(model, data);
    this.homeQpos = new Float64Array(NUM_ARM_JOINTS);
    for (let i = 0; i < NUM_ARM_JOINTS; i++) {
      this.homeQpos[i] = data.qpos[i];
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
   * Numerical IK with TCP offset. Wrist joints locked to home values (no rotation).
   * Only joints NOT in LOCKED_JOINTS are solved.
   */
  private solveIK(target: Position): Float64Array {
    const { mj, model, data } = this.state;

    const origQpos = new Float64Array(model.nq);
    for (let i = 0; i < model.nq; i++) origQpos[i] = data.qpos[i];

    // Lock wrist joints to home values
    const lockedSet = new Set(LOCKED_JOINTS);
    for (const j of LOCKED_JOINTS) {
      data.qpos[j] = this.homeQpos[j];
    }

    const perturbDelta = 0.0001;
    const maxJointStep = 0.1;

    for (let iter = 0; iter < IK_MAX_ITER; iter++) {
      mj.mj_forward(model, data);

      const [tcpX, tcpY, tcpZ] = this.getTcpPos(data);
      const dx = target.x - tcpX;
      const dy = target.y - tcpY;
      const dz = target.z - tcpZ;
      const posErr = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (posErr < IK_TOL) break;

      // Numerical Jacobian of TCP position — only for unlocked joints
      const Jx = new Float64Array(NUM_ARM_JOINTS);
      const Jy = new Float64Array(NUM_ARM_JOINTS);
      const Jz = new Float64Array(NUM_ARM_JOINTS);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        if (lockedSet.has(j)) continue; // skip locked joints
        const saved = data.qpos[j];
        data.qpos[j] = saved + perturbDelta;
        mj.mj_forward(model, data);
        const [ntcpX, ntcpY, ntcpZ] = this.getTcpPos(data);
        Jx[j] = (ntcpX - tcpX) / perturbDelta;
        Jy[j] = (ntcpY - tcpY) / perturbDelta;
        Jz[j] = (ntcpZ - tcpZ) / perturbDelta;
        data.qpos[j] = saved;
      }
      mj.mj_forward(model, data);

      // dq = J^T * error (only for unlocked joints)
      const dq = new Float64Array(NUM_ARM_JOINTS);
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        if (lockedSet.has(j)) continue;
        dq[j] = Jx[j] * dx + Jy[j] * dy + Jz[j] * dz;
      }

      let maxAbs = 0;
      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        maxAbs = Math.max(maxAbs, Math.abs(dq[j]));
      }
      const scale = maxAbs > maxJointStep ? maxJointStep / maxAbs : 1.0;

      for (let j = 0; j < NUM_ARM_JOINTS; j++) {
        if (lockedSet.has(j)) continue;
        data.qpos[j] += scale * dq[j];
        const lo = model.jnt_range[j * 2 + 0];
        const hi = model.jnt_range[j * 2 + 1];
        if (lo < hi) {
          data.qpos[j] = Math.max(lo, Math.min(hi, data.qpos[j]));
        }
      }

      // Re-enforce locked joints (in case of numerical drift)
      for (const j of LOCKED_JOINTS) {
        data.qpos[j] = this.homeQpos[j];
      }
    }

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
      // Always enforce locked wrist joints
      for (const j of LOCKED_JOINTS) {
        data.qpos[j] = this.homeQpos[j];
        data.ctrl[j] = this.homeQpos[j];
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
