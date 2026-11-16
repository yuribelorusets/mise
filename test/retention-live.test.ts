/**
 * Retention has to reach a server that stays up, not only the file it will read at the next restart.
 * The daily compaction rewrites the ledger, but the store the owner views read from keeps its own copy of every order.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { Ledger } from "../src/ops/ledger.js";

const DAY = 86_400_000;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.MISE_TODAY;
  delete process.env.ADMIN_TOKEN;
});

describe("retention on a server that stays up", () => {
  it("removes old names and phones from the owner dashboard and CSV when the daily compaction runs, without a restart", async () => {
    process.env.MISE_TODAY = "2026-12-04";
    process.env.ADMIN_TOKEN = "owner-secret";
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const timers = vi.spyOn(globalThis, "setInterval");
    const app = createApp({ llm: new MockLLM(), ledger: new Ledger(dir, "ruki"), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 100 } });
    // The task createApp put on the daily timer.
    const daily = timers.mock.calls.find(([, ms]) => ms === DAY)?.[0] as (() => void) | undefined;
    expect(daily, "createApp schedules a daily compaction").toBeTypeOf("function");

    const server = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
    const addr = server.address();
    const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    const chat = (message: string) =>
      fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "guest-1", message }) });
    const admin = (path: string) => fetch(`${url}/admin/api/${path}`, { headers: { authorization: "Bearer owner-secret" } });
    try {
      await chat("Can I preorder 2 syrniki?");
      await chat("10:30");
      await chat("Sam, 510-555-0105");
      expect(await (await admin("orders.csv")).text()).toContain("510-555-0105"); // the order went through

      // 100 days later (retention is 90) the timer fires. Only the clock is faked, so the server keeps answering.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 100 * DAY);
      daily!();

      // The file on disk is clean...
      expect(readFileSync(join(dir, "ruki.jsonl"), "utf8")).not.toContain("510-555-0105");
      // ...and what the owner can open and export has to be clean too.
      const csv = await (await admin("orders.csv")).text();
      const summary = JSON.stringify(await (await admin("summary")).json());
      expect(csv).toContain("Syrniki"); // the order itself is kept for totals
      expect(csv).not.toContain("510-555-0105");
      expect(csv).not.toMatch(/"Sam"/);
      expect(summary).not.toContain("510-555-0105");
      expect(summary).not.toMatch(/"name":"Sam"/);
    } finally {
      server.close();
    }
  });
});
