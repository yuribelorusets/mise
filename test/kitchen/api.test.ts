import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createApp } from "../../src/server.js";
import { MockLLM } from "../../src/llm/mock.js";
import { WebhookClient } from "../../src/integrations/webhook.js";
import { loadRestaurant, RestaurantStore } from "../../src/domain/restaurant.js";
import { MemoryStore } from "../../src/kitchen/memory-store.js";
import { ProposalBook } from "../../src/kitchen/proposals.js";
import { explode } from "../../src/kitchen/plan.js";
import type { LLM, LLMResponse } from "../../src/llm/types.js";
import type { Catalog, ProposalLine, StockEvent } from "../../src/kitchen/types.js";

const ruki: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));
const seed: Catalog = { ...ruki, plans: [{ id: "plan-dec-5", date: "2026-12-05", lines: [{ item: "syrniki", qty: 40, unit: "order", source: "manual" }] }] };

let server: Server;
let base = "";
let cookie = "";
const kitchenStore = new MemoryStore(seed);
const book = new ProposalBook(kitchenStore);
const restaurant = new RestaurantStore(loadRestaurant("ruki"));

const kitchen = (path: string, init: RequestInit = {}) =>
  fetch(`${base}/api/kitchen${path}`, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) } });
const post = (path: string, body: unknown = {}) => kitchen(path, { method: "POST", body: JSON.stringify(body) });
const receive: ProposalLine = { kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case" };

beforeAll(async () => {
  process.env.MISE_TODAY = "2026-12-04";
  const app = createApp({
    llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1000 },
    kitchen: kitchenStore, proposals: book, store: restaurant, ownerPasscode: "syrniki-2026",
  });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const res = await fetch(`${base}/api/owner/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode: "syrniki-2026" }) });
  cookie = res.headers.get("set-cookie")!.split(";")[0];
});
afterAll(() => server.close());

describe("kitchen API", () => {
  it("confirms once when two confirms arrive together over HTTP", async () => {
    const p = book.create({ source: "chat", lines: [receive] });
    const before = (await (await kitchen("/stock")).json()).basedOn;
    const [a, b] = await Promise.all([1, 2].map(() => kitchen(`/proposals/${p.id}/confirm`, { method: "POST", body: "{}" })));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
    expect((await (await kitchen("/stock")).json()).basedOn).toBe(before + 1);
  });

  it("refuses a stale confirm with 409 and books it after a refresh", async () => {
    const p = book.create({ source: "chat", lines: [{ kind: "count", item: "eggs", location: "walk-in", qty: 360, unit: "each" }] });
    await post("/counts", { clientId: "count-test-0001", location: "walk-in", lines: [{ item: "eggs", qty: 300, unit: "each" }] });
    expect((await post(`/proposals/${p.id}/confirm`)).status).toBe(409);
    const fresh = await (await post(`/proposals/${p.id}/refresh`)).json();
    expect(fresh.stale).toBe(false);
    expect((await post(`/proposals/${p.id}/confirm`)).status).toBe(200);
  });

  it("writes a retried count once", async () => {
    const body = { clientId: "count-test-0002", location: "dry", lines: [{ item: "flour", qty: 2, unit: "kg" }] };
    const one = await (await post("/counts", body)).json();
    const two = await (await post("/counts", body)).json();
    expect(two.events).toEqual(one.events);
    const history = await (await kitchen("/stock/flour/history")).json();
    expect(history.filter((e: { id: string }) => e.id.startsWith("count-count-test-0002"))).toHaveLength(1);
  });

  it("refuses a bad count and writes nothing", async () => {
    const before = kitchenStore.events().length;
    const res = await post("/counts", { clientId: "count-test-0003", location: "dry", lines: [{ item: "flour", qty: 2, unit: "kg" }, { item: "sumac", qty: 1, unit: "g" }] });
    expect(res.status).toBe(422);
    expect((await res.json()).problems[1]).toMatch(/sumac/);
    expect((await post("/counts", { clientId: "x", location: "dry", lines: [{ item: "flour", qty: 2, unit: "kg" }] })).status).toBe(400);
    expect(kitchenStore.events()).toHaveLength(before);
  });

  it("refuses a catalog change that breaks a recipe", async () => {
    const res = await kitchen("/catalog/items/flour", { method: "DELETE" });
    expect(res.status).toBe(422);
    expect((await res.json()).errors.join(" ")).toMatch(/flour/);
    expect(kitchenStore.catalog().items.some((i) => i.id === "flour")).toBe(true);
  });

  it("adds, replaces and removes catalog records", async () => {
    const item = { id: "sumac", name: "Sumac", aliases: [], baseUnit: "g", units: {}, allergens: [] };
    const added = await (await post("/catalog/items", item)).json();
    expect(added.items.find((i: { id: string }) => i.id === "sumac")).toBeTruthy();
    const renamed = await (await post("/catalog/items", { ...item, name: "Ground sumac" })).json();
    expect(renamed.items.filter((i: { id: string }) => i.id === "sumac")).toHaveLength(1);
    const removed = await (await kitchen("/catalog/items/sumac", { method: "DELETE" })).json();
    expect(removed.items.some((i: { id: string }) => i.id === "sumac")).toBe(false);
    expect((await post("/catalog/shelves", item)).status).toBe(400);
    expect((await kitchen("/catalog/items/nope", { method: "DELETE" })).status).toBe(404);
  });

  it("adds an item only when its id is free, and never takes an id from the body", async () => {
    const before = kitchenStore.catalog().items.length;
    const res = await post("/items", { id: "eggs", name: "Сумах", baseUnit: "g" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "sumakh", name: "Сумах", aliases: [], baseUnit: "g", units: {}, allergens: [] });
    expect(kitchenStore.catalog().items).toHaveLength(before + 1);
    const eggs = structuredClone(kitchenStore.catalog().items.find((i) => i.id === "eggs"));
    const again = await post("/items", { name: "Sumakh", baseUnit: "g" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already in the catalog as "sumakh"/);
    expect((await post("/items", { name: "Eggs!", baseUnit: "ml" })).status).toBe(409);
    expect(kitchenStore.catalog().items.find((i) => i.id === "eggs")).toEqual(eggs);
    expect(kitchenStore.catalog().items).toHaveLength(before + 1);
    expect((await post("/items", { name: "🥚", baseUnit: "g" })).status).toBe(422);
    expect((await post("/items", { name: "Dill", baseUnit: "bunch" })).status).toBe(422);
    expect((await post("/items", { baseUnit: "g" })).status).toBe(422);
    expect((await fetch(`${base}/api/kitchen/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Dill", baseUnit: "g" }) })).status).toBe(401);
    await kitchen("/catalog/items/sumakh", { method: "DELETE" });
  });

  it("refuses a new item whose name is already an item or alias", async () => {
    const before = structuredClone(kitchenStore.catalog());
    for (const name of ["Творог", "Farmer's cheese", "Tvorog!"]) {
      const res = await post("/items", { name, baseUnit: "g" });
      expect(res.status, name).toBe(409);
      expect(await res.json()).toMatchObject({ existing: "farmers-cheese", error: expect.stringContaining("farmers-cheese") });
    }
    expect(kitchenStore.catalog()).toEqual(before);
  });

  it("keeps counts of an item called constructor, at a location called name", async () => {
    expect((await post("/items", { name: "constructor", baseUnit: "g" })).status).toBe(201);
    expect((await post("/catalog/locations", { id: "name", name: "Name shelf", shelfOrder: ["constructor"] })).status).toBe(200);
    const counted = await post("/counts", { clientId: "count-test-ctor-1", location: "name", lines: [{ item: "constructor", qty: 5, unit: "g" }] });
    expect(counted.status).toBe(200);
    const res = await kitchen("/stock");
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(Object.hasOwn(view.lastCount, "constructor")).toBe(true);
    expect(view.lastCount.constructor.name.qty).toBe(5);
  });

  it("shows preorders on Today without phones, notes or last names", async () => {
    restaurant.placeOrder({ name: "Anna Petrova", phone: "510-555-0101", items: [{ item: "syrniki", quantity: 2 }], pickupTime: "11:00", notes: "gate code 1234" }, new Date("2026-12-04T18:00:00-08:00"));
    const today = await (await kitchen("/today")).json();
    const text = JSON.stringify(today.preorders);
    expect(today.date).toBe("2026-12-05");
    expect(today.preorders[0]).toEqual({ firstName: "Anna", pickupTime: "11:00", items: [{ name: "Babushka's Syrniki", quantity: 2 }] });
    expect(text).not.toMatch(/Petrova|555|1234/);
  });

  it("rolls preorders into the plans, Today and the plan result", async () => {
    const plans = await (await kitchen("/plans")).json();
    expect(plans[0].lines).toEqual([
      { item: "syrniki", qty: 40, unit: "order", source: "manual" },
      { item: "syrniki", qty: 2, unit: "order", source: "preorder" },
    ]);
    const expected = explode(seed, [{ item: "syrniki", qty: 42, unit: "order", source: "manual" }], {}).prep;
    const today = await (await kitchen("/today")).json();
    expect(today.prep.map((t: { recipe: string; qty: number }) => [t.recipe, t.qty])).toEqual(expected.map((t) => [t.recipe, t.qty]));
    const result = await (await kitchen("/plans/plan-dec-5/result")).json();
    expect(result.prep.map((t: { recipe: string; qty: number }) => [t.recipe, t.qty])).toEqual(expected.map((t) => [t.recipe, t.qty]));
  });

  it("shows whole amounts on the plan result for things counted each", async () => {
    // At 0.3 eggs an order, 10001 orders need 3000.3 eggs: fractional, and more than earlier tests leave on hand.
    const plan = { id: "plan-each-rounding", date: "2026-12-19", lines: [{ item: "syrniki", qty: 10001, unit: "order", source: "manual" }] };
    expect((await post("/catalog/plans", plan)).status).toBe(200);
    try {
      const result = await (await kitchen("/plans/plan-each-rounding/result")).json();
      const eggs = result.shopping.find((s: { item: string }) => s.item === "eggs");
      expect(eggs).toBeDefined();
      expect([eggs.need, eggs.buy].every(Number.isInteger)).toBe(true);
    } finally {
      await kitchen("/catalog/plans/plan-each-rounding", { method: "DELETE" });
    }
  });

  it("makes a plan on the fly for a date with preorders and no plan", async () => {
    const other = new RestaurantStore({ ...loadRestaurant("ruki"), popup: { ...loadRestaurant("ruki").popup, eventDate: "2026-12-12" } });
    other.placeOrder({ name: "Sam", phone: "510-555-0202", items: [{ item: "syrniki", quantity: 1 }], pickupTime: "11:00" }, new Date("2026-12-04T18:00:00-08:00"));
    restaurant.orders.push(...other.orders);
    const plans = await (await kitchen("/plans")).json();
    expect(plans.find((p: { date: string }) => p.date === "2026-12-12")).toEqual({ id: "preorders-2026-12-12", date: "2026-12-12", lines: [{ item: "syrniki", qty: 1, unit: "order", source: "preorder" }] });
    expect((await kitchen("/plans/preorders-2026-12-12/result")).status).toBe(200);
    restaurant.orders.splice(restaurant.orders.length - 1, 1);
  });

  it("stores only the manual lines when a plan is saved", async () => {
    const lines = [{ item: "syrniki", qty: 30, unit: "order", source: "manual" }, { item: "syrniki", qty: 2, unit: "order", source: "preorder" }];
    expect((await post("/catalog/plans", { id: "plan-dec-19", date: "2026-12-19", lines })).status).toBe(200);
    expect(kitchenStore.catalog().plans.find((p) => p.id === "plan-dec-19")!.lines).toEqual([lines[0]]);
  });

  it("refuses a saved plan whose id looks like a made-up preorder plan", async () => {
    const res = await post("/catalog/plans", { id: "preorders-2026-12-26", date: "2026-12-26", lines: [] });
    expect(res.status).toBe(422);
    expect(kitchenStore.catalog().plans.some((p) => p.id.startsWith("preorders-"))).toBe(false);
  });

  it("shows the preorder lines in Today's plan", async () => {
    const today = await (await kitchen("/today")).json();
    expect(today.plan.lines).toContainEqual({ item: "syrniki", qty: 2, unit: "order", source: "preorder" });
  });

  it("refuses to start when a menu item makes something the kitchen doesn't have", () => {
    const base = loadRestaurant("ruki");
    const wrong = (makes: { item: string; unit: string }) => ({ ...base, menu: base.menu.map((m) => (m.id === "syrniki" ? { ...m, makes } : m)) });
    const start = (config: ReturnType<typeof wrong>) => createApp({ config, llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), kitchen: new MemoryStore(seed) });
    expect(() => start(wrong({ item: "nope", unit: "order" }))).toThrow(/syrniki.*nope/);
    expect(() => start(wrong({ item: "syrniki", unit: "bunch" }))).toThrow(/syrniki.*bunch/);
  });

  it("names prep tasks by recipe, not by id", async () => {
    const today = await (await kitchen("/today")).json();
    expect(today.prep.length).toBeGreaterThan(0);
    expect(today.prep.every((t: { recipe: string; recipeName: string }) => t.recipeName && t.recipeName !== t.recipe)).toBe(true);
    expect(today.shopping.every((s: { name: string }) => s.name)).toBe(true);
  });

  it("answers a number for a max batch", async () => {
    expect((await (await kitchen("/max-batch?item=syrniki&unit=order")).json()).max).toEqual(expect.any(Number));
    expect((await kitchen("/max-batch?item=syrniki")).status).toBe(400);
  });

  it("answers null for a max batch that stock doesn't limit", async () => {
    await post("/catalog/items", { id: "tea-test", name: "Tea", aliases: [], baseUnit: "each", units: {}, allergens: [] });
    await post("/catalog/recipes", { id: "tea-test", name: "Tea", makes: "tea-test", yield: { qty: 1, unit: "each" }, components: [] });
    expect(await (await kitchen("/max-batch?item=tea-test&unit=each")).json()).toEqual({ max: null });
  });

  it("doesn't call a real shelf unlimited on the max-batch route", async () => {
    const count = (n: number, id: string) => post("/counts", { clientId: id, location: "dry", lines: [{ item: "flour", qty: n, unit: "g" }] });
    await count(12000, "flour-count-0001");
    expect(await (await kitchen("/max-batch?item=flour&unit=g")).json()).toEqual({ max: 12000 });
    await count(2_000_000, "flour-count-0002");
    expect(await (await kitchen("/max-batch?item=flour&unit=g")).json()).toEqual({ max: null });
  });

  it("serves the read routes", async () => {
    expect((await (await kitchen("/catalog")).json()).items.length).toBeGreaterThan(0);
    const stock = await (await kitchen("/stock")).json();
    expect(stock).toMatchObject({ basedOn: expect.any(Number), onHand: expect.any(Object), lastCount: expect.any(Object), lastReceived: expect.any(Object) });
    expect(stock.lastReceived.eggs).toEqual(expect.any(String));
    expect((await (await kitchen("/stock/eggs/history")).json()).length).toBeGreaterThan(0);
    expect((await kitchen("/stock/sumac/history")).status).toBe(404);
    expect((await (await kitchen("/plans")).json())[0].id).toBe("plan-dec-5");
    const result = await (await kitchen("/plans/plan-dec-5/result")).json();
    expect(result.prep[0].recipeName).toBeTruthy();
    expect((await kitchen("/plans/nope/result")).status).toBe(404);
    expect(await (await kitchen("/cost?item=syrniki&qty=2&unit=order")).json()).toEqual({ cost: expect.any(Number), missing: expect.any(Array) });
    expect((await kitchen("/cost?item=syrniki&qty=2&unit=bunch")).status).toBe(422);
    expect((await kitchen("/cost?item=syrniki")).status).toBe(400);
  });

  it("lists, gets, discards proposals", async () => {
    const p = book.create({ source: "chat", lines: [receive] });
    expect((await (await kitchen("/proposals?status=open")).json()).map((x: { id: string }) => x.id)).toContain(p.id);
    expect((await (await kitchen(`/proposals/${p.id}`)).json()).id).toBe(p.id);
    expect((await kitchen("/proposals/p-nope")).status).toBe(404);
    expect((await post(`/proposals/${p.id}/discard`)).status).toBe(200);
    expect((await (await kitchen("/proposals?status=open")).json()).map((x: { id: string }) => x.id)).not.toContain(p.id);
    expect((await post(`/proposals/${p.id}/confirm`)).status).toBe(409);
  });

  it("books the owner's edited lines and reports bad ones as 422", async () => {
    const p = book.create({ source: "chat", lines: [receive] });
    const bad = await post(`/proposals/${p.id}/confirm`, { lines: [{ ...receive, unit: "qt" }] });
    expect(bad.status).toBe(422);
    expect((await bad.json()).problems[0]).toEqual(expect.any(String));
    expect((await post(`/proposals/${p.id}/confirm`, { lines: [{ ...receive, qty: 1 }] })).status).toBe(200);
    expect(book.get(p.id)?.lines[0].qty).toBe(1);
  });

  it("answers the assistant route and checks its input", async () => {
    const res = await post("/assistant", { sessionId: "owner-1", message: "received 2 cases of eggs" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ reply: expect.any(String), proposals: [{ status: "open", lines: [{ kind: "receive", item: "eggs" }] }] });
    expect(book.get(body.proposals[0].id)?.status).toBe("open"); // proposed, not booked
    expect((await post("/assistant", { sessionId: "owner-1", message: "" })).status).toBe(400);
    expect((await post("/assistant", { sessionId: "owner-1", message: "x".repeat(2001) })).status).toBe(400);
  });

  it("answers 404 for an unknown item on cost and max-batch, not 500", async () => {
    expect((await kitchen("/cost?item=nope&qty=1&unit=each")).status).toBe(404);
    expect((await kitchen("/max-batch?item=nope&unit=each")).status).toBe(404);
  });
});

describe("selling from stock, through the app", () => {
  it("sells the third order and refuses the fourth when stock covers three", async () => {
    process.env.MISE_TODAY = "2026-12-04";
    const base = loadRestaurant("ruki");
    const config = { ...base, popup: { ...base.popup, sellFromStock: true, maxOrdersPerPhone: 10 } };
    // Per order: 75 g cheese, 0.3 eggs, 15 g flour, 6 g sugar, 40 g sour cream, 30 g jam. Cheese runs out after three.
    const have: [string, number][] = [["farmers-cheese", 230], ["eggs", 1], ["flour", 50], ["sugar", 20], ["sour-cream", 130], ["jam", 100]];
    const stock: StockEvent[] = have.map(([item, qty]) => ({ id: `s-${item}`, at: "2026-12-01T10:00:00Z", kind: "receive", item, location: "walk-in", qty, source: "manual" }));
    const kitchenOnly = new MemoryStore({ ...ruki, plans: [] });
    kitchenOnly.append(stock);
    // Each message is a phone number; the model orders one syrniki for that guest, then repeats the tool's answer.
    const llm: LLM = {
      name: "scripted",
      async complete(req): Promise<LLMResponse> {
        const last = req.messages.at(-1)!;
        if (typeof last.content === "string")
          return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${Math.random()}`, name: "place_order", input: { name: "Guest", phone: last.content, items: [{ item: "syrniki", quantity: 1 }], pickupTime: "11:00" } }] };
        const result = last.content.map((b) => (b.type === "tool_result" ? b.content : "")).join("");
        return { stop_reason: "end_turn", content: [{ type: "text", text: result }] };
      },
    };
    const app = createApp({ config, llm, webhook: new WebhookClient({ url: "", fallbackFile: null }), kitchen: kitchenOnly, limits: { perMinute: 1000 } });
    const s = await new Promise<Server>((r) => { const x = app.listen(0, () => r(x)); });
    const a = s.address();
    const url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    const chat = async (phone: string) => (await (await fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: `g-${phone}`, message: phone }) })).json()).reply as string;
    const replies: string[] = [];
    for (const phone of ["510-555-0301", "510-555-0302", "510-555-0303", "510-555-0304"]) replies.push(await chat(phone));
    s.close();
    expect(replies.slice(0, 3).join("\n")).not.toMatch(/sold out|only|left/i);
    expect(replies[3]).toMatch(/sold out|only 0|0 left/i);
  });
});

describe("stock limits when the owner edits the catalog", () => {
  const base = loadRestaurant("ruki");
  const config = { ...base, popup: { ...base.popup, sellFromStock: true } };
  // Per order: 75 g cheese, 0.3 eggs, 15 g flour, 6 g sugar, 40 g sour cream, 30 g jam. Enough for ten, not eleven.
  const have: [string, number][] = [["farmers-cheese", 790], ["eggs", 3.2], ["flour", 160], ["sugar", 64], ["sour-cream", 420], ["jam", 315]];
  const planOf = (qty: number): Catalog => ({ ...ruki, plans: [{ id: "p", date: "2026-12-05", lines: [{ item: "syrniki", qty, unit: "order", source: "manual" }] }] });
  const stocked = (c: Catalog) => {
    const k = new MemoryStore(c);
    k.append(have.map(([item, qty]) => ({ id: `s-${item}`, at: "2026-12-01T10:00:00Z", kind: "receive" as const, item, location: "walk-in", qty, source: "manual" as const })));
    return k;
  };
  const llm: LLM = {
    name: "scripted",
    async complete(req): Promise<LLMResponse> {
      const last = req.messages.at(-1)!;
      if (typeof last.content === "string") {
        const search = last.content === "search";
        const input = search
          ? { query: "syrniki" }
          : { name: "Guest", phone: last.content, items: [{ item: "syrniki", quantity: 1 }], pickupTime: "11:00" };
        return { stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${Math.random()}`, name: search ? "search_menu" : "place_order", input }] };
      }
      return { stop_reason: "end_turn", content: [{ type: "text", text: last.content.map((b) => (b.type === "tool_result" ? b.content : "")).join("") }] };
    },
  };
  async function serve(kitchenStore: MemoryStore) {
    process.env.MISE_TODAY = "2026-12-04";
    const app = createApp({ config, llm, webhook: new WebhookClient({ url: "", fallbackFile: null }), kitchen: kitchenStore, limits: { perMinute: 1000 } });
    const s = await new Promise<Server>((r) => { const x = app.listen(0, () => r(x)); });
    const a = s.address();
    const url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    let n = 0;
    const say = async (message: string) => {
      const res = await fetch(`${url}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: `e-${n++}`, message }) });
      return { status: res.status, reply: String((await res.json()).reply) };
    };
    return { say, close: () => s.close() };
  }
  const remaining = (reply: string) => Number(/"remaining":\s*(\d+)/.exec(reply)?.[1]);

  it("follows a plan edit that keeps the catalog the same size", async () => {
    const k = stocked(planOf(4));
    const app = await serve(k);
    expect(remaining((await app.say("search")).reply)).toBe(6);
    k.saveCatalog(planOf(6));
    expect(remaining((await app.say("search")).reply)).toBe(4);
    app.close();
  });

  it("falls back to the menu quantity when the kitchen item has been removed", async () => {
    const k = stocked(planOf(4));
    const app = await serve(k);
    const gone = planOf(4);
    gone.recipes = gone.recipes.filter((r) => r.makes !== "syrniki");
    gone.items = gone.items.filter((i) => i.id !== "syrniki");
    gone.plans = [];
    k.saveCatalog(gone);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const search = await app.say("search");
    expect(search.status).toBe(200);
    expect(remaining(search.reply)).toBe(40);
    const order = await app.say("510-555-0401");
    expect(order.status).toBe(200);
    expect(order.reply).not.toMatch(/error/i);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
    app.close();
  });
});
