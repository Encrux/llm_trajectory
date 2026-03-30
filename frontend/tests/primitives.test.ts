import { describe, it, expect } from "vitest";
import { Scene } from "../src/core/scene";
import {
  getHandler,
  registeredNames,
  toOpenAITools,
} from "../src/core/primitives";

const scene = new Scene("test", [
  { name: "Banana", position: { x: 0.3, y: 0.1, z: 0.02 }, category: "fruit" },
  { name: "Bowl", position: { x: 0.7, y: 0.0, z: 0.0 }, category: "container" },
]);

describe("registry", () => {
  it("has all primitives registered", () => {
    const names = registeredNames();
    expect(names).toContain("move_to_point");
    expect(names).toContain("move_to_point_offset");
    expect(names).toContain("open_gripper");
    expect(names).toContain("close_gripper");
    expect(names).toContain("wait");
  });

  it("throws on unknown primitive", () => {
    expect(() => getHandler("fly_away")).toThrow("fly_away");
  });
});

describe("toOpenAITools", () => {
  it("generates valid schemas", () => {
    const tools = toOpenAITools();
    expect(tools.length).toBeGreaterThanOrEqual(5);
    const move = tools.find(
      (t: any) => t.function.name === "move_to_point",
    ) as any;
    expect(move.type).toBe("function");
    expect(move.function.parameters.properties.point_name.type).toBe("string");
  });

  it("excludes scene param from schemas", () => {
    const tools = toOpenAITools() as any[];
    for (const tool of tools) {
      expect(tool.function.parameters.properties).not.toHaveProperty("scene");
    }
  });
});

describe("handlers", () => {
  it("move_to_point resolves position", () => {
    const prim = getHandler("move_to_point");
    const wp = prim.handler(scene, { point_name: "Banana" });
    expect(wp.position).toEqual({ x: 0.3, y: 0.1, z: 0.02 });
    expect(wp.label).toContain("Banana");
  });

  it("move_to_point_offset adds offset", () => {
    const prim = getHandler("move_to_point_offset");
    const wp = prim.handler(scene, {
      point_name: "Banana",
      x_offset: 0,
      y_offset: 0,
      z_offset: 0.1,
    });
    expect(wp.position!.z).toBeCloseTo(0.12);
  });

  it("open_gripper returns gripper waypoint", () => {
    const wp = getHandler("open_gripper").handler(scene, {});
    expect(wp.gripper).toBe("open");
    expect(wp.position).toBeUndefined();
  });

  it("close_gripper returns gripper waypoint", () => {
    const wp = getHandler("close_gripper").handler(scene, {});
    expect(wp.gripper).toBe("close");
  });

  it("wait returns wait waypoint", () => {
    const wp = getHandler("wait").handler(scene, { seconds: 2.5 });
    expect(wp.wait).toBe(2.5);
  });

  it("throws on unknown object", () => {
    const prim = getHandler("move_to_point");
    expect(() => prim.handler(scene, { point_name: "Mango" })).toThrow("Mango");
  });
});
