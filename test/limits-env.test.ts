/**
 * The spend limits come from environment variables the owner types into a hosting dashboard.
 * A value that isn't a number must not switch a limit off.
 */
import { describe, it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { limitsFromEnv } from "../src/ops/guardrails.js";

afterEach(() => {
  delete process.env.MISE_DAILY_BUDGET_USD;
  delete process.env.MISE_MAX_TURNS;
  delete process.env.MISE_RATE_PER_MIN;
});

describe("limitsFromEnv", () => {
  it.each([["MISE_MAX_TURNS", "turnsPerSession", 30], ["MISE_RATE_PER_MIN", "perMinute", 10], ["MISE_DAILY_BUDGET_USD", "dailyBudgetUsd", 2]] as const)(
    "falls back to the default when %s isn't a number",
    (name, key, def) => {
      for (const bad of ["NaN", "abc", "", "-1", "0"]) {
        process.env[name] = bad;
        expect(limitsFromEnv()[key]).toBe(def);
      }
      process.env[name] = "5";
      expect(limitsFromEnv()[key]).toBe(5);
    },
  );
});

describe("limits from the environment", () => {
  it.each(["$2", "2 dollars", "abc", "NaN"])("still stops spending when MISE_DAILY_BUDGET_USD is %j", async (bad) => {
    process.env.MISE_DAILY_BUDGET_USD = bad;
    let calls = 0;
    // Every model call costs $5, well over the $2 default.
    const pricey = { name: "anthropic:claude-sonnet-5-5", complete: async () => { calls++; return { content: [{ type: "text" as const, text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 2_500_000, output_tokens: 0 } }; } };
    let app: ReturnType<typeof createApp>;
    try {
      app = createApp({ llm: pricey, webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 100 } });
    } catch {
      return; // refusing to start with a bad budget is fine too
    }
    const server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
    const addr = server.address();
    const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    const chat = (sessionId: string) =>
      fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message: "hello" }) });
    let last: unknown;
    try {
      for (let i = 0; i < 4; i++) last = await (await chat(`s${i}`)).json();
    } finally {
      server.close();
    }
    expect(calls).toBe(1);
    expect(last).toMatchObject({ handoff: true, limited: "budget" });
  });
});
