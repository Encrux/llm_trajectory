import type { Position, Trajectory, Waypoint } from "../core/types";
import type { MujocoState } from "./mujocoLoader";

export type AnimatorStatus = "idle" | "running" | "paused" | "done" | "error";

export interface AnimatorCallbacks {
  onStepStart?: (index: number, waypoint: Waypoint) => void;
  onStepComplete?: (index: number) => void;
  onStatusChange?: (status: AnimatorStatus) => void;
  onError?: (error: Error) => void;
}

// How many sim steps to take per waypoint (at 0.002s timestep, 500 steps = 1s)
const STEPS_PER_MOVE = 750; // 1.5s per move waypoint
const STEPS_PER_GRIPPER = 300; // 0.6s for gripper action
const SIM_STEPS_PER_FRAME = 10; // steps per requestAnimationFrame call

export class Animator {
  private state: MujocoState;
  private trajectory: Trajectory | null = null;
  private currentStep = 0;
  private stepsRemaining = 0;
  private status: AnimatorStatus = "idle";
  private callbacks: AnimatorCallbacks;
  private frameId: number | null = null;
  private gripperActuatorIdx = -1;

  // Interpolation for smooth mocap movement
  private startPos: Position | null = null;
  private targetPos: Position | null = null;
  private totalSteps = 0;

  constructor(state: MujocoState, callbacks: AnimatorCallbacks = {}) {
    this.state = state;
    this.callbacks = callbacks;
    this.findGripperActuator();
  }

  private findGripperActuator(): void {
    const { mj, model } = this.state;
    for (let i = 0; i < model.nu; i++) {
      const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_ACTUATOR.value, i) || "";
      if (name === "actuator8" || name.includes("finger") || name.includes("gripper")) {
        this.gripperActuatorIdx = i;
        break;
      }
    }
    // Fallback: last actuator is typically the gripper
    if (this.gripperActuatorIdx === -1) {
      this.gripperActuatorIdx = this.state.model.nu - 1;
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

    // Enable weld constraint(s) so mocap drives the arm
    this.setWeldActive(true);

    // Sync mocap to current hand position before starting
    this.syncMocapToHand();

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
    // Disable weld so arm returns to actuator-controlled idle
    this.setWeldActive(false);
  }

  private setWeldActive(active: boolean): void {
    const { model, data } = this.state;
    // The weld constraint is the last equality constraint (added by our scene XML)
    // Keep the finger coupling constraint (index 0) always active
    const weldIdx = model.neq - 1;
    data.eq_active[weldIdx] = active ? 1 : 0;
  }

  private syncMocapToHand(): void {
    const { mj, model, data } = this.state;
    const handId = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY.value, "hand");
    if (handId >= 0) {
      data.mocap_pos[0] = data.xpos[handId * 3 + 0];
      data.mocap_pos[1] = data.xpos[handId * 3 + 1];
      data.mocap_pos[2] = data.xpos[handId * 3 + 2];
      if (data.mocap_quat.length >= 4) {
        data.mocap_quat[0] = data.xquat[handId * 4 + 0];
        data.mocap_quat[1] = data.xquat[handId * 4 + 1];
        data.mocap_quat[2] = data.xquat[handId * 4 + 2];
        data.mocap_quat[3] = data.xquat[handId * 4 + 3];
      }
    }
  }

  getStatus(): AnimatorStatus {
    return this.status;
  }

  getCurrentStepIndex(): number {
    return this.currentStep;
  }

  private setStatus(status: AnimatorStatus): void {
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private cancelFrame(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private prepareStep(): void {
    if (!this.trajectory) return;
    const wp = this.trajectory.waypoints[this.currentStep];
    this.callbacks.onStepStart?.(this.currentStep, wp);

    if (wp.position) {
      // Read current mocap position as start
      const { data } = this.state;
      this.startPos = {
        x: data.mocap_pos[0],
        y: data.mocap_pos[1],
        z: data.mocap_pos[2],
      };
      this.targetPos = wp.position;
      this.totalSteps = STEPS_PER_MOVE;
      this.stepsRemaining = STEPS_PER_MOVE;
    } else if (wp.gripper) {
      // Set gripper control
      const { data } = this.state;
      // Panda gripper: 255 = open (fingers at 0.04m), 0 = closed (fingers at 0)
      data.ctrl[this.gripperActuatorIdx] = wp.gripper === "open" ? 255 : 0;
      this.startPos = null;
      this.targetPos = null;
      this.totalSteps = STEPS_PER_GRIPPER;
      this.stepsRemaining = STEPS_PER_GRIPPER;
    } else if (wp.wait !== undefined) {
      this.startPos = null;
      this.targetPos = null;
      const waitSteps = Math.round(wp.wait / 0.002);
      this.totalSteps = waitSteps;
      this.stepsRemaining = waitSteps;
    }
  }

  private tick = (): void => {
    if (this.status !== "running" || !this.trajectory) return;

    const { mj, model, data } = this.state;

    // Advance simulation by SIM_STEPS_PER_FRAME steps
    const stepsThisFrame = Math.min(SIM_STEPS_PER_FRAME, this.stepsRemaining);

    for (let i = 0; i < stepsThisFrame; i++) {
      // Interpolate mocap position if this is a move waypoint
      if (this.startPos && this.targetPos) {
        const t = 1 - this.stepsRemaining / this.totalSteps;
        const s = smoothstep(t);
        data.mocap_pos[0] = this.startPos.x + (this.targetPos.x - this.startPos.x) * s;
        data.mocap_pos[1] = this.startPos.y + (this.targetPos.y - this.startPos.y) * s;
        data.mocap_pos[2] = this.startPos.z + (this.targetPos.z - this.startPos.z) * s;
      }

      mj.mj_step(model, data);
      this.stepsRemaining--;
    }

    if (this.stepsRemaining <= 0) {
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
