from __future__ import annotations

from typing import Protocol

from llm_trajectory.transpiler.trajectory import Trajectory


class RobotBackend(Protocol):
    def execute(self, trajectory: Trajectory) -> None: ...
