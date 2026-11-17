import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createApp } from "../../src/server.js";
import { MockLLM } from "../../src/llm/mock.js";
import { WebhookClient } from "../../src/integrations/webhook.js";
import { loadRestaurant, RestaurantStore } from "../../src/domain/restaurant.js";
import { MemoryStore } from "../../src/kitchen/memory-store.js";
import { ProposalBook } from "../../src/kitchen/proposals.js";
import { explode } from "../../src/kitchen/plan.js";
import type { Catalog, ProposalLine } from "../../src/kitchen/types.js";

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
