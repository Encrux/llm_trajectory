import type { ApiConfig } from "./core/types";

export const config: ApiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "https://llm-api.boesch.dev",
  model: import.meta.env.VITE_MODEL || "qwen/qwen3-32b",
};
