import { describe, it, expect } from "vitest";
import { Scene } from "../src/core/scene";
import { buildPrompt, SUGGESTED_PROMPT } from "../src/core/prompt";

const scene = new Scene("test", [
  { name: "Banana", position: { x: 0.3, y: 0.1, z: 0.02 }, category: "fruit" },
  { name: "Bowl", position: { x: 0.7, y: 0.0, z: 0.0 }, category: "container" },
]);

describe("buildPrompt", () => {
  it("includes scene description", () => {
    const prompt = buildPrompt(scene, "Pick up the banana");
    expect(prompt).toContain("Banana");
    expect(prompt).toContain("Bowl");
    expect(prompt).toContain("fruit");
  });

  it("includes task", () => {
    const prompt = buildPrompt(scene, "Pick up the banana");
    expect(prompt).toContain("Pick up the banana");
  });

  it("includes instructions", () => {
    const prompt = buildPrompt(scene, "test");
    expect(prompt).toContain("Do NOT invent coordinates");
    expect(prompt).toContain("pick-and-place");
  });
});

describe("SUGGESTED_PROMPT", () => {
  it("is defined", () => {
    expect(SUGGESTED_PROMPT).toBeTruthy();
  });
});
