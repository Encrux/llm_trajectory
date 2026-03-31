import type { ApiConfig, ToolCall } from "./types";

export async function callLLM(
  systemPrompt: string,
  tools: object[],
  config: ApiConfig,
): Promise<ToolCall[]> {
  const body: Record<string, unknown> = {
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

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiToken) {
    headers["Authorization"] = `Bearer ${config.apiToken}`;
  }

  const response = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  console.log("[llm] response:", JSON.stringify(message, null, 2));
  if (!message?.tool_calls || message.tool_calls.length === 0) {
    console.warn("[llm] No tool calls in response. Content:", message?.content || message?.reasoning);
    return [];
  }

  return message.tool_calls.map(
    (tc: { function: { name: string; arguments: string } }) => ({
      name: tc.function.name,
      params: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
    }),
  );
}
