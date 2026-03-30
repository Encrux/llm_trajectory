import { describe, it, expect } from "vitest";
import { Scene } from "../src/core/scene";
import { transpile } from "../src/core/transpiler";
import type { ToolCall } from "../src/core/types";

const scene = new Scene("test", [
  { name: "Banana", position: { x: 0.3, y: 0.1, z: 0.02 } },
  { name: "Bowl", position: { x: 0.7, y: 0.0, z: 0.0 } },
]);

describe("transpile", () => {
  it("transpiles a single move", () => {
    const calls: ToolCall[] = [
      { name: "move_to_point", params: { point_name: "Banana" } },
    ];
    const traj = transpile(calls, scene);
    expect(traj.waypoints).toHaveLength(1);
    expect(traj.waypoints[0].position).toEqual({ x: 0.3, y: 0.1, z: 0.02 });
  });

  it("transpiles a pick sequence", () => {
    const calls: ToolCall[] = [
      { name: "move_to_point_offset", params: { point_name: "Banana", x_offset: 0, y_offset: 0, z_offset: 0.1 } },
      { name: "open_gripper", params: {} },
      { name: "move_to_point", params: { point_name: "Banana" } },
      { name: "close_gripper", params: {} },
      { name: "move_to_point_offset", params: { point_name: "Banana", x_offset: 0, y_offset: 0, z_offset: 0.15 } },
    ];
    const traj = transpile(calls, scene);
    expect(traj.waypoints).toHaveLength(5);
    expect(traj.waypoints[0].position!.z).toBeCloseTo(0.12);
    expect(traj.waypoints[1].gripper).toBe("open");
    expect(traj.waypoints[3].gripper).toBe("close");
    expect(traj.waypoints[4].position!.z).toBeCloseTo(0.17);
  });

  it("throws on unknown primitive", () => {
    const calls: ToolCall[] = [{ name: "fly_away", params: {} }];
    expect(() => transpile(calls, scene)).toThrow("fly_away");
  });

  it("handles empty call list", () => {
    const traj = transpile([], scene);
    expect(traj.waypoints).toHaveLength(0);
  });
});
