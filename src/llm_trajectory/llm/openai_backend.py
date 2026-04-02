from __future__ import annotations

import json
import os

from llm_trajectory.resolver.resolver import ToolCall


class OpenAILLM:
    def __init__(self, model: str = "gpt-4o", api_key: str | None = None):
        try:
            from openai import OpenAI
        except ImportError:
            raise ImportError("Install the openai extra: pip install llm-trajectory[openai]")
        self.client = OpenAI(api_key=api_key or os.environ["OPENAI_API_KEY"])
        self.model = model

    def generate(self, system: str, tools: list[dict]) -> list[ToolCall]:
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": "Execute the task described in the system prompt."},
            ],
            tools=tools,
        )

        tool_calls = []
        message = response.choices[0].message
        if message.tool_calls:
            for tc in message.tool_calls:
                tool_calls.append(
                    ToolCall(name=tc.function.name, params=json.loads(tc.function.arguments))
                )
        return tool_calls
