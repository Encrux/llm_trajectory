import type { ApiConfig } from "./core/types";

const DEFAULT_CONFIG: ApiConfig = {
  baseUrl: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
  apiToken: import.meta.env.VITE_API_TOKEN || "",
  model: import.meta.env.VITE_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct",
};

const STORAGE_KEY = "llm-trajectory-config";

export function loadConfig(): ApiConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: ApiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}
