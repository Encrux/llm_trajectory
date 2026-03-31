import { describe, it, expect } from "vitest";
import { Scene } from "../src/core/scene";
import { transpile } from "../src/core/transpiler";
import type { ToolCall } from "../src/core/types";

const scene = new Scene("test", [
  { name: "Banana", position: { x: 0.3, y: 0.1, z: 0.02 } },
  { name: "Bowl", position: { x: 0.7, y: 0.0, z: 0.0 } },
]);

describe("transpile", () => {
  it("transpiles atomic primitives", () => {
    const calls: ToolCall[] = [
      { name: "move_to_point", params: { point_name: "Banana" } },
      { name: "open_gripper", params: {} },
    ];
    const traj = transpile(calls, scene);
    expect(traj.waypoints).toHaveLength(2);
    expect(traj.groups).toHaveLength(2);
    expect(traj.groups[0].waypoints).toHaveLength(1);
  });

  it("transpiles higher-order pick into multiple waypoints", () => {
    const calls: ToolCall[] = [
      { name: "pick", params: { object_name: "Banana" } },
    ];
    const traj = transpile(calls, scene);
    expect(traj.groups).toHaveLength(1);
    expect(traj.groups[0].waypoints.length).toBeGreaterThan(1);
    expect(traj.groups[0].label).toContain("pick");
    // Flat waypoints should include all expanded steps
    expect(traj.waypoints.length).toBe(traj.groups[0].waypoints.length);
  });

  it("transpiles higher-order place into multiple waypoints", () => {
    const calls: ToolCall[] = [
      { name: "place", params: { target_name: "Bowl" } },
    ];
    const traj = transpile(calls, scene);
    expect(traj.groups).toHaveLength(1);
    expect(traj.groups[0].waypoints.length).toBeGreaterThan(1);
  });

  it("transpiles mixed high and low level calls", () => {
    const calls: ToolCall[] = [
      { name: "pick", params: { object_name: "Banana" } },
      { name: "place", params: { target_name: "Bowl" } },
    ];
    const traj = transpile(calls, scene);
    expect(traj.groups).toHaveLength(2);
    // Total waypoints = pick steps + place steps
    const totalWaypoints = traj.groups.reduce((sum, g) => sum + g.waypoints.length, 0);
    expect(traj.waypoints).toHaveLength(totalWaypoints);
  });

  it("throws on unknown primitive", () => {
    const calls: ToolCall[] = [{ name: "fly_away", params: {} }];
    expect(() => transpile(calls, scene)).toThrow("fly_away");
  });

  it("handles empty call list", () => {
    const traj = transpile([], scene);
    expect(traj.waypoints).toHaveLength(0);
    expect(traj.groups).toHaveLength(0);
  });
});
