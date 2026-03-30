import { Scene } from "../core/scene";
import type { SceneObject } from "../core/types";
import type { MujocoState } from "./mujocoLoader";

// Bodies to exclude from the scene (robot links, table, floor, etc.)
const EXCLUDED_NAMES = new Set([
  "", "world", "table", "target",
  "link0", "link1", "link2", "link3", "link4", "link5", "link6", "link7",
  "hand", "left_finger", "right_finger",
]);

export function extractScene(state: MujocoState): Scene {
  const { mj, model, data } = state;
  const objects: SceneObject[] = [];

  for (let bodyId = 0; bodyId < model.nbody; bodyId++) {
    const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY.value, bodyId) || "";
    if (EXCLUDED_NAMES.has(name)) continue;

    const x = data.xpos[bodyId * 3 + 0];
    const y = data.xpos[bodyId * 3 + 1];
    const z = data.xpos[bodyId * 3 + 2];

    objects.push({
      name,
      position: { x, y, z },
      mujocoBodyId: bodyId,
    });
  }

  return new Scene("mujoco_scene", objects);
}
