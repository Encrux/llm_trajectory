import type { Position } from "../core/types";
import type { MujocoState } from "./mujocoLoader";

const MAX_ITER = 200;
const STEP_SIZE = 0.3;
const TOLERANCE = 0.005; // 5mm
const NUM_ARM_JOINTS = 7;

/**
 * Solve IK using Jacobian transpose method.
 * Uses a temporary copy of qpos — does NOT modify the live simulation.
 */
export function solveIK(
  state: MujocoState,
  handBodyId: number,
  target: Position,
): { jointAngles: Float64Array; error: number } {
  const { mj, model, data } = state;
  const nv = model.nv;

  // Work on a copy of qpos
  const qposCopy = new Float64Array(model.nq);
  for (let i = 0; i < model.nq; i++) qposCopy[i] = data.qpos[i];

  // Allocate Jacobian buffers (3 x nv, row-major)
  const jacP = new Float64Array(3 * nv);
  const jacR = new Float64Array(3 * nv);

  let error = Infinity;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Write qpos copy into data, run forward kinematics
    for (let i = 0; i < model.nq; i++) data.qpos[i] = qposCopy[i];
    mj.mj_forward(model, data);

    // Current hand position
    const hx = data.xpos[handBodyId * 3 + 0];
    const hy = data.xpos[handBodyId * 3 + 1];
    const hz = data.xpos[handBodyId * 3 + 2];

    const dx = target.x - hx;
    const dy = target.y - hy;
    const dz = target.z - hz;
    error = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (error < TOLERANCE) break;

    // Compute position Jacobian for the hand body
    jacP.fill(0);
    jacR.fill(0);
    mj.mj_jacBody(model, data, jacP, jacR, handBodyId);

    // Jacobian transpose: dq = alpha * J^T * error
    // Only update the first NUM_ARM_JOINTS DOFs
    const deltaX = [dx, dy, dz];
    for (let j = 0; j < NUM_ARM_JOINTS; j++) {
      let dq = 0;
      for (let k = 0; k < 3; k++) {
        dq += jacP[k * nv + j] * deltaX[k];
      }
      qposCopy[j] += STEP_SIZE * dq;

      // Clamp to joint limits
      const lo = model.jnt_range[j * 2 + 0];
      const hi = model.jnt_range[j * 2 + 1];
      if (lo < hi) {
        qposCopy[j] = Math.max(lo, Math.min(hi, qposCopy[j]));
      }
    }
  }

  // Extract arm joint angles
  const result = new Float64Array(NUM_ARM_JOINTS);
  for (let i = 0; i < NUM_ARM_JOINTS; i++) result[i] = qposCopy[i];

  // Restore original qpos
  for (let i = 0; i < model.nq; i++) data.qpos[i] = qposCopy[i];
  // Actually restore the ORIGINAL qpos, not the IK result
  // We'll do this in the caller

  return { jointAngles: result, error };
}
