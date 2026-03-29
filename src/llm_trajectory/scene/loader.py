from __future__ import annotations

from pathlib import Path

import yaml

from llm_trajectory.scene.models import Position, Scene, SceneObject


def load_scene(path: str | Path) -> Scene:
    """Load a scene from a YAML file."""
    path = Path(path)
    with open(path) as f:
        data = yaml.safe_load(f)

    objects = []
    for obj_data in data.get("objects", []):
        pos = obj_data["position"]
        objects.append(
            SceneObject(
                name=obj_data["name"],
                position=Position(x=pos[0], y=pos[1], z=pos[2]),
                category=obj_data.get("category"),
                properties=obj_data.get("properties", {}),
            )
        )

    bounds = None
    if "workspace_bounds" in data:
        b = data["workspace_bounds"]
        bounds = (
            Position(x=b["min"][0], y=b["min"][1], z=b["min"][2]),
            Position(x=b["max"][0], y=b["max"][1], z=b["max"][2]),
        )

    return Scene(name=data["name"], objects=objects, workspace_bounds=bounds)
