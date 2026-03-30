import type { Scene } from "./scene";
import type { PrimitiveDef, Waypoint } from "./types";
import { offsetPosition } from "./types";

export const PRIMITIVES: readonly PrimitiveDef[] = [
  {
    name: "move_to_point",
    description: "Move the end-effector to the named object's position.",
    parameters: {
      type: "object",
      properties: {
        point_name: {
          type: "string",
          description: "Name of the target object",
        },
      },
      required: ["point_name"],
    },
    handler: (scene: Scene, params: Record<string, unknown>): Waypoint => {
      const obj = scene.getObject(params.point_name as string);
      return { position: obj.position, label: `move_to(${params.point_name})` };
    },
  },
  {
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
    handler: (scene: Scene, params: Record<string, unknown>): Waypoint => {
      const obj = scene.getObject(params.point_name as string);
      const pos = offsetPosition(
        obj.position,
        params.x_offset as number,
        params.y_offset as number,
        params.z_offset as number,
      );
      return {
        position: pos,
        label: `move_to_offset(${params.point_name})`,
      };
    },
  },
  {
    name: "open_gripper",
    description: "Open the gripper to release an object.",
    parameters: { type: "object", properties: {}, required: [] },
    handler: (): Waypoint => ({ gripper: "open", label: "open_gripper" }),
  },
  {
    name: "close_gripper",
    description: "Close the gripper to grasp an object.",
    parameters: { type: "object", properties: {}, required: [] },
    handler: (): Waypoint => ({ gripper: "close", label: "close_gripper" }),
  },
  {
    name: "wait",
    description: "Pause execution for the specified duration.",
    parameters: {
      type: "object",
      properties: {
        seconds: { type: "number", description: "Duration in seconds" },
      },
      required: ["seconds"],
    },
    handler: (_scene: Scene, params: Record<string, unknown>): Waypoint => ({
      wait: params.seconds as number,
      label: `wait(${params.seconds})`,
    }),
  },
];

const registry = new Map<string, PrimitiveDef>(
  PRIMITIVES.map((p) => [p.name, p]),
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
  return PRIMITIVES.map((p) => ({
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
