from __future__ import annotations

import os

from llm_trajectory.transpiler.transpiler import ToolCall


class ClaudeLLM:
    def __init__(self, model: str = "claude-sonnet-4-20250514", api_key: str | None = None):
        try:
            import anthropic
        except ImportError:
            raise ImportError("Install the claude extra: pip install llm-trajectory[claude]")
        self.client = anthropic.Anthropic(api_key=api_key or os.environ["ANTHROPIC_API_KEY"])
        self.model = model

    def generate(self, system: str, tools: list[dict]) -> list[ToolCall]:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=4096,
            system=system,
            tools=tools,
            messages=[{"role": "user", "content": "Execute the task described in the system prompt."}],
        )

        tool_calls = []
        for block in response.content:
            if block.type == "tool_use":
                tool_calls.append(ToolCall(name=block.name, params=block.input))
        return tool_calls
