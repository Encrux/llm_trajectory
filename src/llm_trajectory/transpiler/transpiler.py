from __future__ import annotations

from dataclasses import dataclass

from llm_trajectory.primitives.registry import get_handler
from llm_trajectory.scene.models import Scene
from llm_trajectory.transpiler.trajectory import Trajectory


@dataclass
class ToolCall:
    name: str
    params: dict


class Transpiler:
    def transpile(self, tool_calls: list[ToolCall], scene: Scene) -> Trajectory:
        trajectory = Trajectory()
        for call in tool_calls:
            handler = get_handler(call.name)
            waypoint = handler(scene, **call.params)
            trajectory.add(waypoint)
        return trajectory
