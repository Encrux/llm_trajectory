from __future__ import annotations

from typing import Protocol

from llm_trajectory.resolver.resolver import ToolCall


class LLMBackend(Protocol):
    def generate(self, system: str, tools: list[dict]) -> list[ToolCall]:
        """Send prompt + tools to the LLM and return a list of tool calls."""
        ...
