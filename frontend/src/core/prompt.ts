import type { Scene } from "./scene";

const SYSTEM_TEMPLATE = `You are a robot policy writer. Given a scene description and a task, you accomplish the task by calling the provided movement primitive tools in sequence.

Rules:
- Refer to objects by their exact name as listed in the scene.
- Do NOT use raw coordinates — the tools handle coordinate resolution.
- Call tools in the order they should be executed.
- Approach objects from above before moving to them (use move_to_point_offset with a positive z_offset first).
- Open the gripper before picking up an object.

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
