from __future__ import annotations

from pathlib import Path

from llm_trajectory.resolver.trajectory import Trajectory


class JsonFileBackend:
    def __init__(self, output_path: str | Path = "trajectory.json"):
        self.output_path = Path(output_path)

    def execute(self, trajectory: Trajectory) -> None:
        self.output_path.write_text(trajectory.to_json())
