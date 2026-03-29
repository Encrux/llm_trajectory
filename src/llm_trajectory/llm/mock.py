from __future__ import annotations

from llm_trajectory.transpiler.transpiler import ToolCall


class MockLLM:
    """Returns hardcoded tool calls for testing without API keys."""

    SCENARIOS: dict[str, list[ToolCall]] = {
        "pick": [
            ToolCall("move_to_point_offset", {"point_name": "Banana", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.10}),
            ToolCall("open_gripper", {}),
            ToolCall("move_to_point", {"point_name": "Banana"}),
            ToolCall("close_gripper", {}),
            ToolCall("move_to_point_offset", {"point_name": "Banana", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.15}),
        ],
        "place": [
            ToolCall("move_to_point_offset", {"point_name": "Banana", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.10}),
            ToolCall("open_gripper", {}),
            ToolCall("move_to_point", {"point_name": "Banana"}),
            ToolCall("close_gripper", {}),
            ToolCall("move_to_point_offset", {"point_name": "Banana", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.15}),
            ToolCall("move_to_point_offset", {"point_name": "Bowl", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.15}),
            ToolCall("move_to_point", {"point_name": "Bowl"}),
            ToolCall("open_gripper", {}),
            ToolCall("move_to_point_offset", {"point_name": "Bowl", "x_offset": 0.0, "y_offset": 0.0, "z_offset": 0.15}),
        ],
    }

    def __init__(self, scenario: str = "pick"):
        self.scenario = scenario

    def generate(self, system: str, tools: list[dict]) -> list[ToolCall]:
        return self.SCENARIOS.get(self.scenario, self.SCENARIOS["pick"])
