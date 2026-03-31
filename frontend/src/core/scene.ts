import type { SceneObject } from "./types";

export interface TableBounds {
  readonly min: [number, number]; // [x_min, y_min]
  readonly max: [number, number]; // [x_max, y_max]
  readonly height: number; // z of table surface
}

export class Scene {
  readonly name: string;
  readonly objects: readonly SceneObject[];
  readonly tableBounds?: TableBounds;

  constructor(name: string, objects: SceneObject[], tableBounds?: TableBounds) {
    this.name = name;
    this.objects = Object.freeze([...objects]);
    this.tableBounds = tableBounds;
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
    const lines = [`Scene: ${this.name}`];

    // Table info
    if (this.tableBounds) {
      const t = this.tableBounds;
      const w = ((t.max[0] - t.min[0]) * 100).toFixed(0);
      const d = ((t.max[1] - t.min[1]) * 100).toFixed(0);
      lines.push("");
      lines.push(`Table: ${w}×${d}cm surface, height ${(t.height * 100).toFixed(1)}cm`);
      lines.push(`  x range: ${t.min[0].toFixed(2)} to ${t.max[0].toFixed(2)}`);
      lines.push(`  y range: ${t.min[1].toFixed(2)} to ${t.max[1].toFixed(2)}`);
      lines.push(`  Objects beyond these ranges will fall off the table.`);
    }

    lines.push("", "Objects:");

    for (const obj of this.objects) {
      const parts = [`  - ${obj.name}`];

      // Shape and size
      if (obj.shape && obj.size) {
        parts.push(`(${obj.shape}, ${obj.size})`);
      } else if (obj.shape) {
        parts.push(`(${obj.shape})`);
      }

      // Category
      if (obj.category) parts.push(`[${obj.category}]`);

      // Properties
      if (obj.properties && Object.keys(obj.properties).length > 0) {
        const props = Object.entries(obj.properties)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        parts.push(`{${props}}`);
      }

      lines.push(parts.join(" "));
    }

    // Spatial relationships
    if (this.objects.length > 1) {
      lines.push("", "Spatial layout:");
      const relationships = this.computeRelationships();
      for (const rel of relationships) {
        lines.push(`  - ${rel}`);
      }
    }

    return lines.join("\n");
  }

  private computeRelationships(): string[] {
    const rels: string[] = [];
    const objs = this.objects;

    for (let i = 0; i < objs.length; i++) {
      const a = objs[i];
      const nearest = this.findNearest(a, objs);
      if (nearest) {
        const dir = this.relativeDirection(a, nearest);
        rels.push(`${a.name} is ${dir} ${nearest.name}`);
      }
    }

    return rels;
  }

  private findNearest(
    obj: SceneObject,
    all: readonly SceneObject[],
  ): SceneObject | null {
    let best: SceneObject | null = null;
    let bestDist = Infinity;
    for (const other of all) {
      if (other === obj) continue;
      const dx = other.position.x - obj.position.x;
      const dy = other.position.y - obj.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = other;
      }
    }
    return best;
  }

  private relativeDirection(from: SceneObject, to: SceneObject): string {
    const dx = to.position.x - from.position.x;
    const dy = to.position.y - from.position.y;

    const parts: string[] = [];
    if (Math.abs(dx) > 0.03) parts.push(dx > 0 ? "in front of" : "behind");
    if (Math.abs(dy) > 0.03) parts.push(dy > 0 ? "to the left of" : "to the right of");

    if (parts.length === 0) return "next to";
    return parts.join(" and ");
  }
}
