import type { SceneObject } from "./types";

export class Scene {
  readonly name: string;
  readonly objects: readonly SceneObject[];

  constructor(name: string, objects: SceneObject[]) {
    this.name = name;
    this.objects = Object.freeze([...objects]);
  }

  getObject(name: string): SceneObject {
    const lower = name.toLowerCase();
    const found = this.objects.find((o) => o.name.toLowerCase() === lower);
    if (!found) {
      const available = this.objects.map((o) => o.name);
      throw new Error(
        `Object '${name}' not found. Available: ${available.join(", ")}`,
      );
    }
    return found;
  }

  getObjectsByCategory(category: string): SceneObject[] {
    const lower = category.toLowerCase();
    return this.objects.filter(
      (o) => o.category?.toLowerCase() === lower,
    );
  }

  objectNames(): string[] {
    return this.objects.map((o) => o.name);
  }

  describe(): string {
    const lines = [`Scene: ${this.name}`, "Objects:"];
    for (const obj of this.objects) {
      const parts = [`  - ${obj.name}`];
      if (obj.category) parts.push(`(category: ${obj.category})`);
      if (obj.properties && Object.keys(obj.properties).length > 0) {
        const props = Object.entries(obj.properties)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        parts.push(`[${props}]`);
      }
      lines.push(parts.join(" "));
    }
    return lines.join("\n");
  }
}
