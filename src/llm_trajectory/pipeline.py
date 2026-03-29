from __future__ import annotations

from llm_trajectory.llm.base import LLMBackend
from llm_trajectory.primitives import handlers as _  # noqa: F401 — triggers @primitive registration
from llm_trajectory.primitives.registry import to_anthropic_tools, to_openai_tools
from llm_trajectory.prompts.builder import PromptBuilder
from llm_trajectory.scene.models import Scene
from llm_trajectory.transpiler.trajectory import Trajectory
from llm_trajectory.transpiler.transpiler import Transpiler


class Pipeline:
    def __init__(self, llm: LLMBackend, tool_format: str = "anthropic"):
        self.llm = llm
        self.transpiler = Transpiler()
        self.tool_format = tool_format

    def run(self, scene: Scene, task: str) -> Trajectory:
        system = PromptBuilder(scene).build(task)

        if self.tool_format == "openai":
            tools = to_openai_tools()
        else:
            tools = to_anthropic_tools()

        tool_calls = self.llm.generate(system, tools)
        trajectory = self.transpiler.transpile(tool_calls, scene)
        trajectory.metadata = {
            "scene": scene.name,
            "task": task,
            "num_steps": len(trajectory.waypoints),
        }
        return trajectory
