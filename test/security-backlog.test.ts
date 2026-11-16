/**
 * Known medium and low findings from the wave-1 security pass. Each test says what should happen and is
 * marked `it.fails`, so it passes while the bug exists. When you fix one, the test starts failing:
 * change `it.fails` to `it` and move the entry in docs/security-backlog.md out of "Open".
 */
import { describe, it, expect } from "vitest";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
import { prepTasks } from "../web/src/fixtures/ruki.js";
const rukiKitchen: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));

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
  // Backlog: "A repeated order for the last of a batch is refused as sold out."
  it.fails("gives a retry its original order back even when that order took the last of the batch", () => {
    const s = new RestaurantStore(ruki);
    const batch = ruki.menu.find((m) => m.id === "syrniki")!.quantity!;
    s.placeOrder({ name: "Setup", phone: "510-555-0001", items: [{ item: "syrniki", quantity: batch - 2 > 20 ? 20 : batch - 2 }], pickupTime: "10:00" }, NOW, { caps: false });
    while (s.remaining("syrniki")! > 2) s.placeOrder({ name: "Setup", phone: "510-555-0001", items: [{ item: "syrniki", quantity: Math.min(20, s.remaining("syrniki")! - 2) }], pickupTime: "10:00" }, NOW, { caps: false });
    const place = () => s.placeOrder({ name: "Anya", phone: "510-555-0100", items: [{ item: "syrniki", quantity: 2 }], pickupTime: "11:00", sessionId: "same" }, NOW);
    const first = place();
    expect(s.remaining("syrniki")).toBe(0);
    expect(place()).toMatchObject({ id: first.id, duplicate: true }); // today: throws "Babushka's Syrniki is sold out."
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
  it.fails("counts stock at a location called 'constructor' like any other", () => {
    const oh = onHand([ev({ location: "constructor", qty: 10 })]);
    expect(total(oh, "eggs")).toBe(10);
  });

  it.fails("doesn't let an event for an item called '__proto__' change every other item's stock", () => {
    const proto = Object.prototype as Record<string, unknown>;
    try {
      const oh = onHand([ev({ item: "__proto__", kind: "count", qty: 500 }), ev({ qty: 10 })]);
      expect(proto["walk-in"]).toBeUndefined();
      expect(total(oh, "eggs")).toBe(10);
    } finally {
      delete proto["walk-in"];
    }
  });

  it.fails("refuses a stock event for an item the store can't hold safely", () => {
    const seed: Catalog = { items: [{ id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: {}, allergens: [] }], locations: [], recipes: [], plans: [] };
    const store = new FileStore(mkdtempSync(join(tmpdir(), "kitchen-")), "test", seed);
    expect(() => store.append([ev({ item: "__proto__" })])).toThrow();
  });

  it.fails("plans an item called 'constructor' with numbers, not strings", () => {
    const c: Catalog = { items: [{ id: "constructor", name: "Odd", aliases: [], baseUnit: "g", units: {}, allergens: [] }], locations: [], recipes: [], plans: [] };
    const { shopping } = explode(c, [{ item: "constructor", qty: 100, unit: "g", source: "manual" }], {});
    expect(shopping).toEqual([{ item: "constructor", need: 100, have: 0, buy: 100 }]);
  });

  // Backlog: "The stock file is replayed without checking for repeated event ids."
  it.fails("counts an event once when its line is in the stock file twice", () => {
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

describe("web fixtures against the kitchen core", () => {
  // Backlog: "The Today fixtures don't match what the kitchen core returns."
  it.fails("names prep tasks the way explode does, by recipe id", () => {
    const real = explode(rukiKitchen as Catalog, [{ item: "syrniki", qty: 40, unit: "order", source: "preorder" }], {}).prep;
    const ids = new Set(rukiKitchen.recipes.map((r) => r.id));
    expect(real.every((t) => ids.has(t.recipe))).toBe(true); // what the API will send
    expect(prepTasks.every((t) => /^[a-z0-9-]+$/.test(t.recipe))).toBe(true); // what the screen was built against
  });
});
