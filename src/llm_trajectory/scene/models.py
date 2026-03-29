from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Position:
    x: float
    y: float
    z: float

    def offset(self, x_offset: float, y_offset: float, z_offset: float) -> Position:
        return Position(x=self.x + x_offset, y=self.y + y_offset, z=self.z + z_offset)

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z}


@dataclass(frozen=True)
class SceneObject:
    name: str
    position: Position
    category: str | None = None
    properties: dict = field(default_factory=dict)


@dataclass
class Scene:
    name: str
    objects: list[SceneObject]
    workspace_bounds: tuple[Position, Position] | None = None

    def get_object(self, name: str) -> SceneObject:
        """Case-insensitive lookup by object name."""
        name_lower = name.lower()
        for obj in self.objects:
            if obj.name.lower() == name_lower:
                return obj
        available = [o.name for o in self.objects]
        raise KeyError(f"Object '{name}' not found in scene. Available: {available}")

    def get_objects_by_category(self, category: str) -> list[SceneObject]:
        return [o for o in self.objects if o.category and o.category.lower() == category.lower()]

    def object_names(self) -> list[str]:
        return [o.name for o in self.objects]

    def describe(self) -> str:
        """Generate a text description of the scene for the LLM prompt."""
        lines = [f"Scene: {self.name}", "Objects:"]
        for obj in self.objects:
            parts = [f"  - {obj.name}"]
            if obj.category:
                parts.append(f"(category: {obj.category})")
            if obj.properties:
                props = ", ".join(f"{k}: {v}" for k, v in obj.properties.items())
                parts.append(f"[{props}]")
            lines.append(" ".join(parts))
        return "\n".join(lines)
