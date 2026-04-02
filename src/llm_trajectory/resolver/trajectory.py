from __future__ import annotations

import json
from dataclasses import dataclass, field

from llm_trajectory.scene.models import Position


@dataclass
class Waypoint:
    position: Position | None = None
    gripper: str | None = None  # "open" or "close"
    wait: float | None = None
    label: str = ""

    def to_dict(self) -> dict:
        d: dict = {"label": self.label}
        if self.position is not None:
            d["position"] = self.position.to_dict()
        if self.gripper is not None:
            d["gripper"] = self.gripper
        if self.wait is not None:
            d["wait"] = self.wait
        return d


@dataclass
class Trajectory:
    waypoints: list[Waypoint] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)

    def add(self, waypoint: Waypoint) -> None:
        self.waypoints.append(waypoint)

    def to_dict(self) -> dict:
        return {
            "metadata": self.metadata,
            "waypoints": [wp.to_dict() for wp in self.waypoints],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)
