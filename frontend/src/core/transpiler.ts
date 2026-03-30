import type { Scene } from "./scene";
import type { ToolCall, Trajectory, Waypoint } from "./types";
import { getHandler } from "./primitives";

export function transpile(
  toolCalls: readonly ToolCall[],
  scene: Scene,
): Trajectory {
  const waypoints: Waypoint[] = toolCalls.map((call) => {
    const prim = getHandler(call.name);
    return prim.handler(scene, call.params);
  });

  return { metadata: {}, waypoints };
}
