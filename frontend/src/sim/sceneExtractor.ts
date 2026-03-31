import { Scene } from "../core/scene";
import type { SceneObject } from "../core/types";
import type { MujocoState } from "./mujocoLoader";

// Bodies to exclude from the scene (robot links, table, floor, etc.)
const EXCLUDED_NAMES = new Set([
  "", "world", "table", "target",
  "link0", "link1", "link2", "link3", "link4", "link5", "link6", "link7",
  "hand", "left_finger", "right_finger",
]);

// MuJoCo geom types
const GEOM_TYPES: Record<number, string> = {
  0: "plane", 2: "sphere", 3: "capsule", 4: "ellipsoid",
  5: "cylinder", 6: "box", 7: "mesh",
};

export function extractScene(state: MujocoState): Scene {
  const { mj, model, data } = state;
  const objects: SceneObject[] = [];

  for (let bodyId = 0; bodyId < model.nbody; bodyId++) {
    const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_BODY.value, bodyId) || "";
    if (EXCLUDED_NAMES.has(name)) continue;

    const x = data.xpos[bodyId * 3 + 0];
    const y = data.xpos[bodyId * 3 + 1];
    const z = data.xpos[bodyId * 3 + 2];

    // Find the first geom belonging to this body to get shape/size
    const { shape, size } = getBodyGeomInfo(model, bodyId);

    objects.push({
      name,
      position: { x, y, z },
      shape,
      size,
      mujocoBodyId: bodyId,
    });
  }

  // Extract table bounds from the "table_top" geom
  const tableBounds = getTableBounds(mj, model, data);

  return new Scene("mujoco_scene", objects, tableBounds);
}

function getTableBounds(
  mj: any,
  model: any,
  data: any,
): { min: [number, number]; max: [number, number]; height: number } | undefined {
  // Find the "table_top" geom
  for (let geomId = 0; geomId < model.ngeom; geomId++) {
    const name = mj.mj_id2name(model, mj.mjtObj.mjOBJ_GEOM.value, geomId) || "";
    if (name !== "table_top") continue;

    const bodyId = model.geom_bodyid[geomId];
    const bx = data.xpos[bodyId * 3 + 0];
    const by = data.xpos[bodyId * 3 + 1];
    const bz = data.xpos[bodyId * 3 + 2];
    const sx = model.geom_size[geomId * 3 + 0]; // half-extents
    const sy = model.geom_size[geomId * 3 + 1];
    const sz = model.geom_size[geomId * 3 + 2];

    return {
      min: [bx - sx, by - sy],
      max: [bx + sx, by + sy],
      height: bz + sz,
    };
  }
  return undefined;
}

function getBodyGeomInfo(
  model: any,
  bodyId: number,
): { shape?: string; size?: string } {
  // Find geoms belonging to this body
  for (let geomId = 0; geomId < model.ngeom; geomId++) {
    if (model.geom_bodyid[geomId] !== bodyId) continue;

    const geomType = model.geom_type[geomId];
    const shape = GEOM_TYPES[geomType];
    if (!shape || shape === "plane" || shape === "mesh") continue;

    const s0 = model.geom_size[geomId * 3 + 0];
    const s1 = model.geom_size[geomId * 3 + 1];
    const s2 = model.geom_size[geomId * 3 + 2];

    const cm = (m: number) => `${(m * 200).toFixed(0)}`;

    let size: string;
    switch (shape) {
      case "sphere":
        size = `${cm(s0)}cm diameter`;
        break;
      case "box":
        size = `${cm(s0)}×${cm(s1)}×${cm(s2)}cm`;
        break;
      case "cylinder":
        size = `${cm(s0)}cm diameter, ${cm(s1)}cm tall`;
        break;
      case "capsule":
        size = `${cm(s0)}cm thick, ${(s1 * 200 + s0 * 200).toFixed(0)}cm long`;
        break;
      default:
        size = "";
    }

    return { shape, size };
  }
  return {};
}
