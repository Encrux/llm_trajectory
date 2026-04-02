import type { Scene } from "./scene";
import type { ToolCall, Trajectory, Waypoint, WaypointGroup } from "./types";
import { getHandler } from "./primitives";

export function resolve(
  toolCalls: readonly ToolCall[],
  scene: Scene,
): Trajectory {
  const groups: WaypointGroup[] = [];
  const allWaypoints: Waypoint[] = [];

  for (const call of toolCalls) {
    const prim = getHandler(call.name);
    const result = prim.handler(scene, call.params);

    // Handler returns either a single Waypoint or Waypoint[] (higher-order)
    const waypoints = Array.isArray(result) ? result : [result];

    const params = Object.entries(call.params || {})
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");

    groups.push({
      label: `${call.name}(${params})`,
      toolCall: call,
      waypoints,
    });

    allWaypoints.push(...waypoints);
  }

  return { metadata: {}, groups, waypoints: allWaypoints };
}
