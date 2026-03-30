import { describe, it, expect } from "vitest";
import { Scene } from "../src/core/scene";
import { offsetPosition } from "../src/core/types";
import type { SceneObject } from "../src/core/types";

const OBJECTS: SceneObject[] = [
  { name: "Banana", position: { x: 0.3, y: 0.1, z: 0.02 }, category: "fruit", properties: { color: "yellow" } },
  { name: "Apple", position: { x: 0.5, y: -0.2, z: 0.02 }, category: "fruit", properties: { color: "red" } },
  { name: "Bowl", position: { x: 0.7, y: 0.0, z: 0.0 }, category: "container" },
];

describe("offsetPosition", () => {
  it("adds offsets correctly", () => {
    const result = offsetPosition({ x: 1, y: 2, z: 3 }, 0.1, -0.2, 0.5);
    expect(result.x).toBeCloseTo(1.1);
    expect(result.y).toBeCloseTo(1.8);
    expect(result.z).toBeCloseTo(3.5);
  });
});

describe("Scene", () => {
  const scene = new Scene("test", OBJECTS);

  it("finds object by name", () => {
    const obj = scene.getObject("Banana");
    expect(obj.name).toBe("Banana");
    expect(obj.position).toEqual({ x: 0.3, y: 0.1, z: 0.02 });
  });

  it("finds object case-insensitively", () => {
    expect(scene.getObject("banana").name).toBe("Banana");
  });

  it("throws on unknown object", () => {
    expect(() => scene.getObject("Mango")).toThrow("Mango");
  });

  it("filters by category", () => {
    const fruits = scene.getObjectsByCategory("fruit");
    expect(fruits).toHaveLength(2);
    expect(fruits.map((o) => o.name).sort()).toEqual(["Apple", "Banana"]);
  });

  it("lists all names", () => {
    expect(scene.objectNames()).toEqual(["Banana", "Apple", "Bowl"]);
  });

  it("describes scene with categories and properties", () => {
    const desc = scene.describe();
    expect(desc).toContain("Banana");
    expect(desc).toContain("fruit");
    expect(desc).toContain("container");
    expect(desc).toContain("yellow");
  });
});
