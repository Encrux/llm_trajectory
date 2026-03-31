import type { Scene } from "./scene";
import type { PrimitiveDef, Waypoint } from "./types";
import { offsetPosition } from "./types";

// ── Atomic primitives ──

const move_to_point: PrimitiveDef = {
  name: "move_to_point",
  description: "Move the end-effector to the named object's position.",
  parameters: {
    type: "object",
    properties: {
      point_name: { type: "string", description: "Name of the target object" },
    },
    required: ["point_name"],
  },
  handler: (scene, params) => {
    const obj = scene.getObject(params.point_name as string);
    return { position: obj.position, label: `move_to(${params.point_name})` };
  },
};

const move_to_point_offset: PrimitiveDef = {
  name: "move_to_point_offset",
  description: "Move to a position offset from the named object.",
  parameters: {
    type: "object",
    properties: {
      point_name: { type: "string", description: "Name of the object" },
      x_offset: { type: "number", description: "X offset in meters" },
      y_offset: { type: "number", description: "Y offset in meters" },
      z_offset: { type: "number", description: "Z offset in meters" },
    },
    required: ["point_name", "x_offset", "y_offset", "z_offset"],
  },
  handler: (scene, params) => {
    const obj = scene.getObject(params.point_name as string);
    const pos = offsetPosition(
      obj.position,
      params.x_offset as number,
      params.y_offset as number,
      params.z_offset as number,
    );
    return { position: pos, label: `move_to_offset(${params.point_name})` };
  },
};

const open_gripper: PrimitiveDef = {
  name: "open_gripper",
  description: "Open the gripper to release an object.",
  parameters: { type: "object", properties: {}, required: [] },
  handler: () => ({ gripper: "open", label: "open_gripper" }),
};

const close_gripper: PrimitiveDef = {
  name: "close_gripper",
  description: "Close the gripper to grasp an object.",
  parameters: { type: "object", properties: {}, required: [] },
  handler: () => ({ gripper: "close", label: "close_gripper" }),
};

const wait_prim: PrimitiveDef = {
  name: "wait",
  description: "Pause execution for the specified duration.",
  parameters: {
    type: "object",
    properties: { seconds: { type: "number", description: "Duration in seconds" } },
    required: ["seconds"],
  },
  handler: (_scene, params) => ({
    wait: params.seconds as number,
    label: `wait(${params.seconds})`,
  }),
};

// ── Higher-order primitives (return Waypoint[]) ──

const pick: PrimitiveDef = {
  name: "pick",
  description: "Pick up an object. Approaches from above, opens gripper, lowers to object, closes gripper, and lifts up.",
  parameters: {
    type: "object",
    properties: {
      object_name: { type: "string", description: "Name of the object to pick up" },
    },
    required: ["object_name"],
  },
  handler: (scene, params): Waypoint[] => {
    const name = params.object_name as string;
    const obj = scene.getObject(name);
    const above = offsetPosition(obj.position, 0, 0, 0.12);
    const lift = offsetPosition(obj.position, 0, 0, 0.15);
    return [
      { position: above, label: `approach_above(${name})` },
      { gripper: "open", label: "open_gripper" },
      { position: obj.position, label: `lower_to(${name})` },
      { gripper: "close", label: "close_gripper" },
      { position: lift, label: `lift(${name})` },
    ];
  },
};

const place: PrimitiveDef = {
  name: "place",
  description: "Place the currently held object at a target location. Moves above target, opens gripper to drop, then lifts away.",
  parameters: {
    type: "object",
    properties: {
      target_name: { type: "string", description: "Name of the target object/location to place at" },
      z_offset: { type: "number", description: "Height above target to release (default 0.08)" },
    },
    required: ["target_name"],
  },
  handler: (scene, params): Waypoint[] => {
    const name = params.target_name as string;
    const obj = scene.getObject(name);
    const dropHeight = (params.z_offset as number) ?? 0.08;
    const hover = offsetPosition(obj.position, 0, 0, dropHeight);
    const liftAway = offsetPosition(obj.position, 0, 0, 0.15);
    return [
      { position: hover, label: `hover_above(${name})` },
      { gripper: "open", label: "open_gripper" },
      { position: liftAway, label: `lift_away(${name})` },
    ];
  },
};

// ── Registry ──

// Only higher-order primitives are exposed to the LLM as tools
const LLM_PRIMITIVES: readonly PrimitiveDef[] = [pick, place, move_to_point, move_to_point_offset, open_gripper, close_gripper, wait_prim];

// All primitives (including atomic) for the transpiler
export const ALL_PRIMITIVES: readonly PrimitiveDef[] = [
  move_to_point, move_to_point_offset, open_gripper, close_gripper, wait_prim,
  pick, place,
];

const registry = new Map<string, PrimitiveDef>(
  ALL_PRIMITIVES.map((p) => [p.name, p]),
);

export function getHandler(name: string): PrimitiveDef {
  const prim = registry.get(name);
  if (!prim) {
    throw new Error(
      `Unknown primitive '${name}'. Available: ${[...registry.keys()].join(", ")}`,
    );
  }
  return prim;
}

export function toOpenAITools(): object[] {
  return LLM_PRIMITIVES.map((p) => ({
    type: "function" as const,
    function: {
      name: p.name,
      description: p.description,
      parameters: p.parameters,
    },
  }));
}

export function registeredNames(): string[] {
  return [...registry.keys()];
}
