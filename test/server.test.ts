import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, staticDir } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { loadRestaurant } from "../src/domain/restaurant.js";

let server: Server;
let base = "";
beforeAll(async () => {
  process.env.MISE_TODAY = "2026-12-04";
  process.env.ADMIN_TOKEN = "owner-secret";
  const app = createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1000 } });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => server.close());
const chat = (url: string, sessionId: string, message: string) =>
  fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message }) });

async function start(app: ReturnType<typeof createApp>) {
  const s = await new Promise<Server>((r) => { const x = app.listen(0, () => r(x)); });
  const a = s.address();
  return { url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, close: () => s.close() };
}

describe("http", () => {
  it("serves the built web app when web/dist exists, and the old pages otherwise", () => {
    expect(staticDir(() => true)).toMatch(/web[\\/]dist$/);
    expect(staticDir(() => false)).toMatch(/public$/);
  });
  it("chats and returns the tool trace", async () => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "a", message: "Do you have sushi?" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.toolCalls[0].name).toBe("search_menu");
    expect(body.reply).toMatch(/don't/);
  });
  it("validates input", async () => {
    const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "" }) });
    expect(res.status).toBe(400);
  });
  it("serves branding for the chat page", async () => {
    const body = await (await fetch(`${base}/api/config`)).json();
    expect(body).toMatchObject({ id: "ruki", name: "Ruki" });
    expect(body.examples.length).toBeGreaterThan(0);
  });
  it("tells guests what is kept, for how long, and who can read it", async () => {
    const { privacyNotice } = await (await fetch(`${base}/api/config`)).json();
    for (const word of [/name/, /phone/, /notes/, /chat/, /90 days/, /owner can read/]) expect(privacyNotice).toMatch(word);
  });
  it("sends the menu with prices for /order", async () => {
    const { menu } = await (await fetch(`${base}/api/config`)).json();
    expect(menu.find((m: { id: string }) => m.id === "syrniki")).toMatchObject({ name: "Babushka's Syrniki", price: 12 });
    expect(menu[0]).not.toHaveProperty("quantity");
  });
  it("serves the app's index.html for app routes once web/dist is built", async () => {
    const webDist = mkdtempSync(join(tmpdir(), "webdist-"));
    mkdirSync(join(webDist, "assets"));
    writeFileSync(join(webDist, "index.html"), '<html><body><div id="root"></div></body></html>');
    writeFileSync(join(webDist, "assets", "app.js"), "console.log(1)");
    const app = await start(createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), webDist }));
    for (const path of ["/count", "/order", "/stock/eggs"]) {
      const res = await fetch(`${app.url}${path}`, { headers: { accept: "text/html" } });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<div id="root">');
    }
    expect((await fetch(`${app.url}/assets/app.js`)).status).toBe(200);
    expect((await fetch(`${app.url}/api/nope`, { headers: { accept: "text/html" } })).status).toBe(404);
    expect((await fetch(`${app.url}/admin/nope`, { headers: { accept: "text/html" } })).status).not.toBe(200);
    expect((await fetch(`${app.url}/assets/missing.js`)).status).toBe(404);
    app.close();
  });
  it("serves the index page when web/dist sits under a dot directory", async () => {
    const webDist = join(mkdtempSync(join(tmpdir(), "webdist-")), ".hidden", "dist");
    mkdirSync(webDist, { recursive: true });
    writeFileSync(join(webDist, "index.html"), '<html><body><div id="root"></div></body></html>');
    const app = await start(createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), webDist }));
    const res = await fetch(`${app.url}/count`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
    app.close();
  });
  it("protects the owner dashboard and reports what happened", async () => {
    expect((await fetch(`${base}/admin/api/summary`)).status).toBe(401);
    expect((await fetch(`${base}/admin/api/summary`, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    await chat(base, "owner-test", "Can I preorder 2 syrniki?");
    await chat(base, "owner-test", "10:30");
    await chat(base, "owner-test", "Sam, 510-555-0105");
    const sum = await (await fetch(`${base}/admin/api/summary`, { headers: { authorization: "Bearer owner-secret" } })).json();
    expect(sum.kpis.orders).toBeGreaterThanOrEqual(1);
    expect(sum.conversations.some((c: { id: string; ordered: boolean }) => c.id === "owner-test" && c.ordered)).toBe(true);
    const csv = await fetch(`${base}/admin/api/orders.csv?token=owner-secret`);
    expect(csv.headers.get("content-type")).toMatch(/csv/);
    expect(await csv.text()).toMatch(/Syrniki/);
  });
});

describe("guardrails", () => {
  const quiet = () => new WebhookClient({ url: "", fallbackFile: null });
  it("rate limits a visitor who floods the chat", async () => {
    const app = await start(createApp({ llm: new MockLLM(), webhook: quiet(), limits: { perMinute: 2 } }));
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await chat(app.url, "flood", "hi")).status);
    app.close();
    expect(codes).toEqual([200, 200, 429]);
  });
  it("stops calling the model once the daily budget is spent", async () => {
    let calls = 0;
    const pricey = { name: "anthropic:claude-sonnet-5-5", complete: async () => { calls++; return { content: [{ type: "text" as const, text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 100_000, output_tokens: 0 } }; } };
    const app = await start(createApp({ llm: pricey, webhook: quiet(), limits: { perMinute: 100, dailyBudgetUsd: 0.1 } }));
    await chat(app.url, "b", "hello"); // spends $0.20
    const body = await (await chat(app.url, "b", "hello again")).json();
    app.close();
    expect(calls).toBe(1);
    expect(body).toMatchObject({ handoff: true, limited: "budget" });
  });
  it("caps very long conversations", async () => {
    const app = await start(createApp({ llm: new MockLLM(), webhook: quiet(), limits: { perMinute: 100, turnsPerSession: 2 } }));
    for (let i = 0; i < 2; i++) await chat(app.url, "long", "hi");
    const body = await (await chat(app.url, "long", "hi")).json();
    app.close();
    expect(body.limited).toBe("turns");
  });
});

describe("pop-up deployment", () => {
  it("brands the chat and takes a preorder end to end", async () => {
    const config = loadRestaurant("ruki");
    const app = await start(createApp({ config, llm: new MockLLM(config), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 100 } }));
    const cfg = await (await fetch(`${app.url}/api/config`)).json();
    await chat(app.url, "r", "Can I preorder 2 syrniki?");
    await chat(app.url, "r", "10:30");
    const done = await (await chat(app.url, "r", "Anya, 510-555-0300")).json();
    app.close();
    expect(cfg).toMatchObject({ name: "Ruki", popup: { eventDate: "2026-12-05" } });
    expect(done.reply).toMatch(/RK-[A-Z0-9]{6}/);
  });

  it("falls back to 90 days when MISE_RETAIN_DAYS isn't a usable number", async () => {
    for (const bad of ["abc", "", "0"]) {
      process.env.MISE_RETAIN_DAYS = bad;
      const app = await start(createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }) }));
      const cfg = await (await fetch(`${app.url}/api/config`)).json();
      app.close();
      expect(cfg.privacyNotice).toMatch(/for 90 days/);
    }
    delete process.env.MISE_RETAIN_DAYS;
  });

  it("tells guests what's kept and for how long", async () => {
    process.env.MISE_RETAIN_DAYS = "60";
    const app = await start(createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }) }));
    const cfg = await (await fetch(`${app.url}/api/config`)).json();
    app.close();
    delete process.env.MISE_RETAIN_DAYS;
    expect(cfg.privacyNotice).toMatch(/60 days/);
    expect(cfg.privacyNotice).toMatch(/name, phone number/i);
  });
});
