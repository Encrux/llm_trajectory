import type { ApiConfig, ToolCall } from "./types";

export async function callLLM(
  systemPrompt: string,
  tools: object[],
  config: ApiConfig,
): Promise<ToolCall[]> {
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: "Execute the task described in the system prompt.",
      },
    ],
    tools,
    tool_choice: "auto",
  };

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message?.tool_calls || message.tool_calls.length === 0) {
    throw new Error("empty_plan");
  }

  return message.tool_calls.map(
    (tc: { function: { name: string; arguments: string } }) => ({
      name: tc.function.name,
      params: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
    }),
  );
}
