import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import type { LLM } from "./llm/types.js";
import { AnthropicLLM } from "./llm/anthropic.js";
import { MockLLM } from "./llm/mock.js";
import type { RestaurantConfig } from "./domain/restaurant.js";

// Load .env (ANTHROPIC_API_KEY etc.) if present. Real environment variables still win.
if (existsSync(".env")) loadEnvFile(".env");

/** Picks the model: Claude when a key is present (or MISE_LLM=anthropic), otherwise the offline mock. */
export function makeLLM(kind = process.env.MISE_LLM, model?: string, config?: RestaurantConfig): LLM {
  const k = kind || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock");
  if (k === "mock") return new MockLLM(config);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required for MISE_LLM=anthropic");
  return new AnthropicLLM(model);
}

/** "Now", frozen to MISE_TODAY at 18:00 local when set, so evals are reproducible. */
export const now = () => (process.env.MISE_TODAY ? new Date(`${process.env.MISE_TODAY}T18:00:00-08:00`) : new Date());
