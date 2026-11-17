/**
 * Known medium and low findings from the wave-1 security pass. Each test says what should happen and is
 * marked `it.fails`, so it passes while the bug exists. When you fix one, the test starts failing:
 * change `it.fails` to `it` and move the entry in docs/security-backlog.md out of "Open".
 */
import { describe, it, expect } from "vitest";
import type { Server } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { MemoryStore } from "../src/kitchen/memory-store.js";
import { runKitchenTool } from "../src/kitchen/assistant/tools.js";
import { ctx } from "./kitchen/assistant/fixtures.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { loadRestaurant, RestaurantStore } from "../src/domain/restaurant.js";
import { Ledger } from "../src/ops/ledger.js";
import { FileStore } from "../src/kitchen/file-store.js";
import { onHand, total } from "../src/kitchen/stock.js";
import { explode } from "../src/kitchen/plan.js";
import type { Catalog, StockEvent } from "../src/kitchen/types.js";

const ruki = loadRestaurant("ruki");
const NOW = new Date("2026-12-04T18:00:00-08:00");
const quiet = () => new WebhookClient({ url: "", fallbackFile: null });

async function start(app: ReturnType<typeof createApp>) {
  const s = await new Promise<Server>((r) => { const x = app.listen(0, () => r(x)); });
  const a = s.address();
  return { url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, close: () => s.close() };
}
const chat = (url: string, sessionId: string, message: string) =>
  fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, message }) });

const ev = (over: Partial<StockEvent>): StockEvent => ({ id: Math.random().toString(36).slice(2), at: "2026-12-01T10:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 10, source: "manual", ...over });

describe("chat limits", () => {
  // Backlog: "The per-conversation turn cap can't be reached at its default."
  it.fails("ends a conversation at the default 30 turns", async () => {
    const app = await start(createApp({ llm: new MockLLM(), webhook: quiet(), limits: { perMinute: 1000 } }));
    let body: { limited?: string } = {};
    try {
      for (let i = 0; i < 35; i++) body = await (await chat(app.url, "long", "hi")).json();
    } finally {
      app.close();
    }
    expect(body.limited).toBe("turns");
  });

  // Backlog: "Nothing slows down guesses at the admin token."
  it.fails("slows down someone guessing the admin token", async () => {
    const before = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "owner-secret";
    const app = await start(createApp({ llm: new MockLLM(), webhook: quiet() }));
    const codes: number[] = [];
    try {
      for (let i = 0; i < 60; i++) codes.push((await fetch(`${app.url}/admin/api/summary`, { headers: { authorization: `Bearer guess-${i}` } })).status);
    } finally {
      app.close();
      if (before === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = before;
    }
    expect(codes).toContain(429);
  });
});

describe("preorders", () => {
  it("gives a retry its original order back even when that order took the last of the batch", () => {
    const s = new RestaurantStore(ruki);
    const batch = ruki.menu.find((m) => m.id === "syrniki")!.quantity!;
    s.placeOrder({ name: "Setup", phone: "510-555-0001", items: [{ item: "syrniki", quantity: batch - 2 > 20 ? 20 : batch - 2 }], pickupTime: "10:00" }, NOW, { caps: false });
    while (s.remaining("syrniki")! > 2) s.placeOrder({ name: "Setup", phone: "510-555-0001", items: [{ item: "syrniki", quantity: Math.min(20, s.remaining("syrniki")! - 2) }], pickupTime: "10:00" }, NOW, { caps: false });
    const place = () => s.placeOrder({ name: "Anya", phone: "510-555-0100", items: [{ item: "syrniki", quantity: 2 }], pickupTime: "11:00", sessionId: "same" }, NOW);
    const first = place();
    expect(s.remaining("syrniki")).toBe(0);
    expect(place()).toMatchObject({ id: first.id, duplicate: true });
  });

  // Backlog: "One bad order line in the ledger stops the server from starting."
  it.fails("starts up when the ledger has an order line with no order in it", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    writeFileSync(join(dir, "ruki.jsonl"), `{"kind":"order","at":"2026-12-01T10:00:00Z"}\n{"kind":"order","at":"2026-12-01T10:00:00Z","value":{"id":"RK-OLD001","name":"Old","phone":"5105550100","total":12,"pickupTime":"11:00"}}\n`);
    const ledger = new Ledger(dir, "ruki");
    expect(() => ledger.compact(new Date("2026-12-04T10:00:00Z"), 90)).not.toThrow();
    const store = new RestaurantStore(ruki, { history: ledger, recorder: ledger });
    expect(() => store.remaining("syrniki")).not.toThrow();
  });
});

describe("kitchen stock", () => {
  // Backlog: "Stock and plan maths trip over ids that are also Object.prototype names."
  it("counts stock at a location called 'constructor' like any other", () => {
    const oh = onHand([ev({ location: "constructor", qty: 10 })]);
    expect(total(oh, "eggs")).toBe(10);
  });

  it("doesn't let an event for an item called '__proto__' change every other item's stock", () => {
    const proto = Object.prototype as Record<string, unknown>;
    try {
      const oh = onHand([ev({ item: "__proto__", kind: "count", qty: 500 }), ev({ qty: 10 })]);
      expect(proto["walk-in"]).toBeUndefined();
      expect(total(oh, "eggs")).toBe(10);
    } finally {
      delete proto["walk-in"];
    }
  });

  it("refuses a stock event for an item the store can't hold safely", () => {
    const seed: Catalog = { items: [{ id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: {}, allergens: [] }], locations: [], recipes: [], plans: [] };
    const store = new FileStore(mkdtempSync(join(tmpdir(), "kitchen-")), "test", seed);
    expect(() => store.append([ev({ item: "__proto__" })])).toThrow();
  });

  it("plans an item called 'constructor' with numbers, not strings", () => {
    const c: Catalog = { items: [{ id: "constructor", name: "Odd", aliases: [], baseUnit: "g", units: {}, allergens: [] }], locations: [], recipes: [], plans: [] };
    const { shopping } = explode(c, [{ item: "constructor", qty: 100, unit: "g", source: "manual" }], {});
    expect(shopping).toEqual([{ item: "constructor", need: 100, have: 0, buy: 100 }]);
  });

  // Backlog: "The stock file is replayed without checking for repeated event ids."
  it("counts an event once when its line is in the stock file twice", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitchen-"));
    const seed: Catalog = { items: [{ id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: {}, allergens: [] }], locations: [], recipes: [], plans: [] };
    // Two processes on one data dir each see an empty log and both append the same confirmed event.
    const a = new FileStore(dir, "test", seed);
    const b = new FileStore(dir, "test", seed);
    const e = ev({ id: "confirm-1", qty: 180 });
    a.append([e]);
    b.append([e]);
    const again = new FileStore(dir, "test", seed);
    expect(total(onHand(again.events()), "eggs")).toBe(180);
  });
});

// ---- Found in the wave-2 pass ----

describe("wave-2 pass", () => {
  const owner = "syrniki-2026";
  async function ownerApp(over: Parameters<typeof createApp>[0] = {}) {
    const app = await start(createApp({ llm: new MockLLM(), webhook: quiet(), limits: { perMinute: 1000 }, ownerPasscode: owner, ...over }));
    const res = await fetch(`${app.url}/api/owner/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: owner }) });
    const cookie = res.headers.get("set-cookie")!.split(";")[0];
    return { ...app, cookie };
  }

  // Backlog: "Deleting the item a menu item makes breaks the owner's Today."
  it.fails("keeps Today working after the item a menu item makes is deleted", async () => {
    const seed: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));
    const kitchen = new MemoryStore({ ...seed, plans: [] });
    const store = new RestaurantStore(ruki);
    store.orders.push({ id: "RK-1", name: "Anna", phone: "5105550101", total: 12, pickupDate: ruki.popup.eventDate, pickupTime: "11:00", items: [{ id: "syrniki", name: "Syrniki", quantity: 2, price: 12 }] });
    process.env.MISE_TODAY = "2026-12-04";
    const app = await ownerApp({ kitchen, store });
    const call = (m: string, p: string) => fetch(`${app.url}/api/kitchen${p}`, { method: m, headers: { "content-type": "application/json", cookie: app.cookie } });
    try {
      await call("DELETE", "/catalog/recipes/syrniki");
      const del = await call("DELETE", "/catalog/items/syrniki");
      expect(del.status).toBe(200); // the catalog accepts it; nothing checks the menu
      expect((await call("GET", "/today")).status).toBe(200);
    } finally {
      app.close();
    }
  });

  // Backlog: "Guest chat and the owner's assistant share one daily budget."
  it.fails("keeps the owner's assistant working when guest chats have used the daily budget", async () => {
    const ledger = new Ledger(undefined, "ruki");
    const app = await ownerApp({ ledger, limits: { perMinute: 1000, dailyBudgetUsd: 5 } });
    try {
      ledger.logTurn({ at: new Date().toISOString(), sessionId: "guest", channel: "chat", user: "hi", reply: "hi", tools: [], handoff: false, model: "claude", inputTokens: 1, outputTokens: 1, costUsd: 6, ms: 1 });
      const res = await fetch(`${app.url}/api/kitchen/assistant`, { method: "POST", headers: { "content-type": "application/json", cookie: app.cookie }, body: JSON.stringify({ sessionId: "s1", message: "what's on hand?" }) });
      expect(res.status).toBe(200);
    } finally {
      app.close();
    }
  });

  // Backlog: "The JSON-only check is case-sensitive and Express routes aren't."
  it.fails("refuses a non-JSON write to /API/ the same as /api/", async () => {
    const app = await ownerApp();
    try {
      const res = await fetch(`${app.url}/API/owner/sign-out`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
      expect(res.status).toBe(415);
    } finally {
      app.close();
    }
  });

  // Backlog: "An offered item's id can replace an item that's already there."
  it("doesn't offer a new item whose id is an existing item's id", () => {
    // "Eggs!" makes the id "eggs", which is taken.
    expect(runKitchenTool("offer_new_item", { name: "Eggs!", baseUnit: "ml" }, ctx()).isError).toBe(true);
  });

  it("doesn't offer a new item whose id would be empty", () => {
    // Russian names are transliterated now, so only a name with no letters or digits has no id.
    expect(runKitchenTool("offer_new_item", { name: "🥚", baseUnit: "g" }, ctx()).isError).toBe(true);
  });
});
