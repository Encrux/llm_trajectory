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
    expect(names).toContain("pick");
    expect(names).toContain("place");
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

  it("includes higher-order primitives", () => {
    const tools = toOpenAITools() as any[];
    const pickTool = tools.find((t) => t.function.name === "pick");
    expect(pickTool).toBeDefined();
    expect(pickTool.function.parameters.properties.object_name.type).toBe("string");
    const placeTool = tools.find((t) => t.function.name === "place");
    expect(placeTool).toBeDefined();
  });

  it("excludes scene param from schemas", () => {
    const tools = toOpenAITools() as any[];
    for (const tool of tools) {
      expect(tool.function.parameters.properties).not.toHaveProperty("scene");
    }
  });
});

describe("atomic handlers", () => {
  it("move_to_point resolves position", () => {
    const prim = getHandler("move_to_point");
    const wp = prim.handler(scene, { point_name: "Banana" });
    const result = Array.isArray(wp) ? wp[0] : wp;
    expect(result.position).toEqual({ x: 0.3, y: 0.1, z: 0.02 });
    expect(result.label).toContain("Banana");
  });

  it("move_to_point_offset adds offset", () => {
    const prim = getHandler("move_to_point_offset");
    const wp = prim.handler(scene, {
      point_name: "Banana", x_offset: 0, y_offset: 0, z_offset: 0.1,
    });
    const result = Array.isArray(wp) ? wp[0] : wp;
    expect(result.position!.z).toBeCloseTo(0.12);
  });

  it("open_gripper returns gripper waypoint", () => {
    const wp = getHandler("open_gripper").handler(scene, {});
    const result = Array.isArray(wp) ? wp[0] : wp;
    expect(result.gripper).toBe("open");
  });

  it("close_gripper returns gripper waypoint", () => {
    const wp = getHandler("close_gripper").handler(scene, {});
    const result = Array.isArray(wp) ? wp[0] : wp;
    expect(result.gripper).toBe("close");
  });

  it("wait returns wait waypoint", () => {
    const wp = getHandler("wait").handler(scene, { seconds: 2.5 });
    const result = Array.isArray(wp) ? wp[0] : wp;
    expect(result.wait).toBe(2.5);
  });

  it("throws on unknown object", () => {
    const prim = getHandler("move_to_point");
    expect(() => prim.handler(scene, { point_name: "Mango" })).toThrow("Mango");
  });
});

describe("higher-order handlers", () => {
  it("pick returns multiple waypoints", () => {
    const prim = getHandler("pick");
    const result = prim.handler(scene, { object_name: "Banana" });
    expect(Array.isArray(result)).toBe(true);
    const wps = result as any[];
    expect(wps.length).toBe(5); // approach, open, lower, close, lift
    expect(wps[0].label).toContain("approach");
    expect(wps[1].gripper).toBe("open");
    expect(wps[3].gripper).toBe("close");
    expect(wps[4].label).toContain("lift");
  });

  it("place returns multiple waypoints", () => {
    const prim = getHandler("place");
    const result = prim.handler(scene, { target_name: "Bowl" });
    expect(Array.isArray(result)).toBe(true);
    const wps = result as any[];
    expect(wps.length).toBe(4); // hover, lower, open, lift
    expect(wps[0].label).toContain("hover");
    expect(wps[1].label).toContain("lower");
    expect(wps[2].gripper).toBe("open");
    expect(wps[3].label).toContain("lift");
  });
});
