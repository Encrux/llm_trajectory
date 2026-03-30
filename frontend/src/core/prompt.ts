import type { Scene } from "./scene";

const SYSTEM_TEMPLATE = `You are a robot policy writer controlling a Franka Panda arm with a parallel-jaw gripper. Given a scene and a task, call the provided tools in the correct sequence.

Rules:
- Refer to objects by their exact name from the scene list.
- Do NOT invent coordinates — the tools resolve positions automatically.
- Always approach from above first (use move_to_point_offset with z_offset=0.1 or 0.15).
- Open the gripper BEFORE lowering to pick up an object.
- After grasping, lift up before moving laterally.
- To place, move above target, lower, open gripper, then lift away.

A typical pick-and-place sequence uses 9 tool calls:
approach above object → open gripper → lower to object → close gripper → lift up → move above target → lower to target → open gripper → lift away

{scene_description}

Task: {task}`;

export function buildPrompt(scene: Scene, task: string): string {
  return SYSTEM_TEMPLATE.replace("{scene_description}", scene.describe()).replace(
    "{task}",
    task,
  );
}

export const SUGGESTED_PROMPT =
  "Pick up the banana and place it in the bowl";
