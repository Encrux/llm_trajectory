import type { Scene } from "./scene";

const SYSTEM_TEMPLATE = `You are a robot policy writer controlling a Franka Panda arm with a parallel-jaw gripper. Given a scene and a task, call the provided tools in the correct sequence.

You have two levels of tools:
- High-level: pick(object_name), place(target_name) — use these when possible for cleaner plans.
- Low-level: move_to_point, move_to_point_offset, open_gripper, close_gripper, wait — use these for fine-grained control when needed.

Rules:
- Refer to objects by their exact name from the scene list.
- Prefer pick() and place() for standard pick-and-place tasks.
- Use low-level primitives for non-standard motions (pushing, nudging, custom approach angles).
- place() drops the object from above the target — you can set z_offset (default 0.08m).
- For stacking, use a larger z_offset on place() to account for the object already there.

{scene_description}

Task: {task}`;

export function buildPrompt(scene: Scene, task: string): string {
  return SYSTEM_TEMPLATE.replace("{scene_description}", scene.describe()).replace(
    "{task}",
    task,
  );
}

export const SUGGESTED_PROMPT =
  "Pick up the red cube and place it on the bowl";
