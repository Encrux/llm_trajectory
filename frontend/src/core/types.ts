import type { Scene } from "./scene";

export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function offsetPosition(
  p: Position,
  dx: number,
  dy: number,
  dz: number,
): Position {
  return { x: p.x + dx, y: p.y + dy, z: p.z + dz };
}

export interface SceneObject {
  readonly name: string;
  readonly position: Position;
  readonly category?: string;
  readonly properties?: Record<string, string>;
  readonly mujocoBodyId?: number;
}

export interface ToolCall {
  readonly name: string;
  readonly params: Record<string, unknown>;
}

export interface Waypoint {
  readonly position?: Position;
  readonly gripper?: "open" | "close";
  readonly wait?: number;
  readonly label: string;
}

/** A group of waypoints produced by a higher-order primitive (pick, place, etc.) */
export interface WaypointGroup {
  readonly label: string; // e.g. "pick(Apple)"
  readonly toolCall: ToolCall; // the original high-level tool call
  readonly waypoints: readonly Waypoint[];
}

export interface Trajectory {
  readonly metadata: Record<string, unknown>;
  readonly groups: readonly WaypointGroup[];
  /** Flat list of all waypoints (for animator) */
  readonly waypoints: readonly Waypoint[];
}

export interface PrimitiveDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: {
    readonly type: "object";
    readonly properties: Record<string, { type: string; description?: string }>;
    readonly required: readonly string[];
  };
  /** Returns one waypoint (atomic) or multiple (higher-order) */
  readonly handler: (
    scene: Scene,
    params: Record<string, unknown>,
  ) => Waypoint | Waypoint[];
}

export interface ApiConfig {
  baseUrl: string;
  apiToken: string;
  model: string;
}
