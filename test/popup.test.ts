import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRestaurant, RestaurantStore } from "../src/domain/restaurant.js";
import { runTool, toolSpecs } from "../src/agent/tools.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { Ledger, scheduleCompaction } from "../src/ops/ledger.js";
import { RateLimiter } from "../src/ops/guardrails.js";
import { costUsd } from "../src/ops/pricing.js";
import { summary, ordersCsv } from "../src/ops/admin.js";

const ruki = loadRestaurant("ruki");
const BEFORE_CUTOFF = new Date("2026-12-04T18:00:00-08:00");
const AFTER_CUTOFF = new Date("2026-12-04T21:00:00-08:00");
let guest = 0; // a new phone number each time, so the per-phone cap doesn't get in the way
const order = (s: RestaurantStore, item: string, quantity: number, pickupTime = "11:00", now = BEFORE_CUTOFF) =>
  s.placeOrder({ name: "Anya", phone: `510-555-${1000 + guest++}`, items: [{ item, quantity }], pickupTime }, now);

describe("pop-up mode", () => {
  it("only offers pop-up tools, and refuses a tool it wasn't given", async () => {
    expect(toolSpecs(ruki).map((t) => t.name)).toEqual(["search_menu", "list_pickup_windows", "place_order", "handoff_to_human"]);
    const store = new RestaurantStore(ruki);
    const out = await runTool("give_discount", { percent: 100 },
      { store, webhook: new WebhookClient({ url: "", fallbackFile: null }), sessionId: "t", channel: "eval", now: BEFORE_CUTOFF });
    expect(out.isError).toBe(true);
    expect(store.orders).toHaveLength(0);
  });

  it("tells the agent how many pieces come in one order", async () => {
    const out = await runTool("search_menu", { query: "сырники" },
      { store: new RestaurantStore(ruki), webhook: new WebhookClient({ url: "", fallbackFile: null }), sessionId: "t", channel: "eval", now: BEFORE_CUTOFF });
    const [syrniki] = (out.content as { results: { id: string; piecesPerOrder?: number }[] }).results;
    expect(syrniki).toMatchObject({ id: "syrniki", piecesPerOrder: 3 });
  });

  it("never sells more than the batch", () => {
    const s = new RestaurantStore(ruki);
    for (let i = 0; i < 8; i++) order(s, "syrniki", 5, ["10:00", "10:30"][i % 2]);
    expect(s.remaining("syrniki")).toBe(0);
    expect(() => order(s, "syrniki", 1)).toThrow(/sold out/);
    expect(s.searchMenu({ query: "syrniki" })[0]).toMatchObject({ soldOut: true, remaining: 0 });
  });

  it("says how many are left instead of overselling", () => {
    const s = new RestaurantStore(ruki);
    for (const n of [5, 5, 5, 5, 5, 2]) order(s, "nalysnyky", n, "10:00");
    expect(() => order(s, "nalysnyky", 4)).toThrow(/Only 3 Nalysnyky left/);
  });

  it("caps orders per pickup window and rejects times that aren't windows", () => {
    const s = new RestaurantStore(ruki);
    for (let i = 0; i < ruki.popup!.ordersPerWindow; i++) order(s, "black-tea", 1, "12:30");
    expect(() => order(s, "black-tea", 1, "12:30")).toThrow(/window is full/);
    expect(() => order(s, "black-tea", 1, "11:15")).toThrow(/isn't a pickup window/);
    expect(s.windows(BEFORE_CUTOFF).find((w) => w.time === "12:30")).toMatchObject({ left: 0, open: false });
  });

  it("closes preorders at the cutoff", () => {
    const s = new RestaurantStore(ruki);
    expect(() => order(s, "black-tea", 1, "11:00", AFTER_CUTOFF)).toThrow(/closed/);
    expect(s.windows(AFTER_CUTOFF).every((w) => !w.open)).toBe(true);
  });

  it("stamps the pop-up date and the restaurant's code prefix on orders", () => {
    const o = order(new RestaurantStore(ruki), "bagel", 2);
    expect(o).toMatchObject({ pickupDate: "2026-12-05", pickupTime: "11:00", total: 14 });
    expect(o.id).toMatch(/^RK-[A-Z0-9]{6}$/);
  });
});

describe("preorder caps", () => {
  it("caps preorders per phone number, however it's formatted", () => {
    const s = new RestaurantStore(ruki);
    const place = (phone: string, sessionId: string) =>
      s.placeOrder({ name: "Anya", phone, items: [{ item: "syrniki", quantity: 1 }], pickupTime: "11:00", sessionId }, BEFORE_CUTOFF);
    place("510-555-0100", "a");
    place("(510) 555-0100", "b");
    expect(() => place("+1 510.555.0100", "c")).toThrow(/already has 2 preorders/);
    expect(() => place("510-555-0199", "d")).not.toThrow();
  });

  it("caps how many of one item a single order can take", () => {
    const s = new RestaurantStore(ruki);
    expect(() => order(s, "syrniki", 7)).toThrow(/at most 6/);
    expect(() => order(s, "syrniki", 6)).not.toThrow();
  });
});

describe("caps and retention together", () => {
  it("a retry in the same session gets the original order back instead of hitting the phone cap", () => {
    const s = new RestaurantStore(ruki);
    const place = () => s.placeOrder({ name: "Anya", phone: "510-555-0100", items: [{ item: "syrniki", quantity: 2 }], pickupTime: "11:00", sessionId: "same" }, BEFORE_CUTOFF);
    const first = place();
    expect(place()).toMatchObject({ id: first.id, duplicate: true });
    expect(place()).toMatchObject({ id: first.id, duplicate: true });
    expect(s.orders).toHaveLength(1);
  });

  it("redacted old orders still count against stock and window capacity after a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const ledger = new Ledger(dir, "ruki");
    const first = new RestaurantStore(ruki, { history: ledger, recorder: ledger });
    order(first, "syrniki", 6, "10:00");
    // Pretend a month passed: compact with a retention shorter than the order's age.
    const later = new Date(Date.now() + 40 * 86_400_000);
    ledger.compact(later, 30);
    const again = new Ledger(dir, "ruki");
    expect(again.orders[0]).toMatchObject({ name: "[removed]", phone: "" });
    const second = new RestaurantStore(ruki, { history: again, recorder: again });
    expect(second.remaining("syrniki")).toBe(34);
    expect(second.windows(BEFORE_CUTOFF).find((w) => w.time === "10:00")?.left).toBe(ruki.popup.ordersPerWindow - 1);
  });
});

describe("ledger", () => {
  it("replays orders after a restart, so a sold-out batch stays sold out", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const a = new Ledger(dir, "ruki");
    order(new RestaurantStore(ruki, { history: a, recorder: a }), "syrniki", 6);
    appendFileSync(join(dir, "ruki.jsonl"), '{"kind":"order","at":"x","value":'); // torn write from a crash

    const b = new Ledger(dir, "ruki");
    const s = new RestaurantStore(ruki, { history: b, recorder: b });
    expect(s.orders).toHaveLength(1);
    expect(s.remaining("syrniki")).toBe(34);
  });

  it("skips reservation lines left in an old ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    appendFileSync(join(dir, "ruki.jsonl"),
      JSON.stringify({ kind: "reservation", at: "2026-11-01T00:00:00Z", value: { code: "FA-ABC123" } }) + "\n" +
      JSON.stringify({ kind: "order", at: "2026-11-01T00:00:00Z", value: { id: "RK-ABC123", items: [] } }) + "\n");
    const ledger = new Ledger(dir, "ruki");
    expect(ledger.orders).toHaveLength(1);
  });

  it("drops old chats and removes names and phones from old orders", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const now = new Date("2026-12-04T18:00:00-08:00");
    const old = "2026-08-01T00:00:00Z", recent = "2026-12-01T00:00:00Z";
    const line = (o: object) => JSON.stringify(o) + "\n";
    appendFileSync(join(dir, "ruki.jsonl"),
      line({ kind: "turn", at: old, value: { at: old, sessionId: "a", user: "hi", reply: "hello" } }) +
      line({ kind: "turn", at: recent, value: { at: recent, sessionId: "b", user: "hi", reply: "hello" } }) +
      line({ kind: "reservation", at: recent, value: { code: "FA-ABC123" } }) +
      line({ kind: "order", at: old, value: { id: "RK-OLD001", name: "Anya", phone: "510-555-0100", items: [], total: 12 } }));
    new Ledger(dir, "ruki").compact(now, 90);
    const after = new Ledger(dir, "ruki");
    expect(after.turns.map((t) => t.sessionId)).toEqual(["b"]);
    expect(after.orders[0]).toMatchObject({ id: "RK-OLD001", name: "[removed]", phone: "", total: 12 });
    const text = readFileSync(join(dir, "ruki.jsonl"), "utf8");
    expect(text).not.toMatch(/510-555-0100/);
    expect(text).not.toMatch(/reservation/);
  });

  it("treats an entry with an unreadable timestamp as old", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const line = (o: object) => JSON.stringify(o) + "\n";
    appendFileSync(join(dir, "ruki.jsonl"),
      line({ kind: "order", at: "garbage", value: { id: "RK-BAD001", name: "Anya", phone: "510-555-0100", items: [], total: 12 } }) +
      line({ kind: "turn", at: "garbage", value: { at: "garbage", sessionId: "x", user: "my number is 510-555-0100" } }));
    new Ledger(dir, "ruki").compact(new Date("2026-12-04T18:00:00-08:00"), 90);
    const after = new Ledger(dir, "ruki");
    expect(after.orders[0]).toMatchObject({ name: "[removed]", phone: "" });
    expect(after.turns).toEqual([]);
  });

  it("also clears notes and session ids on old orders", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    appendFileSync(join(dir, "ruki.jsonl"), JSON.stringify({ kind: "order", at: "2026-01-01T00:00:00Z",
      value: { id: "RK-OLD002", name: "Anya", phone: "510-555-0100", notes: "Anya, call 510-555-0100", sessionId: "s-1", items: [], total: 12 } }) + "\n");
    new Ledger(dir, "ruki").compact(new Date("2026-12-04T18:00:00-08:00"), 90);
    const text = readFileSync(join(dir, "ruki.jsonl"), "utf8");
    expect(text).not.toMatch(/510-555-0100|Anya|s-1/);
    expect(new Ledger(dir, "ruki").orders[0]).toMatchObject({ id: "RK-OLD002", total: 12 });
  });

  it("applies the same retention to the webhook fallback file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const file = join(dir, "events.jsonl");
    const now = new Date("2026-12-04T18:00:00-08:00");
    const ev = (id: string, occurredAt: string) =>
      JSON.stringify({ id, type: "order.placed", occurredAt, sessionId: "s", channel: "chat", data: { name: "Anya", phone: "510-555-0100", notes: "gate code 42" } }) + "\n";
    appendFileSync(file, ev("old", "2026-08-01T00:00:00Z") + ev("bad", "garbage") + ev("new", "2026-12-01T00:00:00Z"));
    const hook = new WebhookClient({ url: "", fallbackFile: file });
    hook.compact(now, 90);
    const text = readFileSync(file, "utf8");
    expect(text.trim().split("\n").map((l) => JSON.parse(l).id)).toEqual(["new"]);
    await hook.send(hook.build("order.placed", "s2", "chat", { name: "Boris" }));
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("compacts again on a timer that doesn't keep the process alive", () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const timer = scheduleCompaction(() => { runs++; }, 1000);
      vi.advanceTimersByTime(2500);
      expect(runs).toBe(2);
      expect(timer.hasRef()).toBe(false);
      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses a retention that isn't a number of days, and keeps today's turns", () => {
    const dir = mkdtempSync(join(tmpdir(), "mise-"));
    const now = new Date("2026-12-04T18:00:00-08:00");
    const today = now.toISOString();
    appendFileSync(join(dir, "ruki.jsonl"), JSON.stringify({ kind: "turn", at: today, value: { at: today, sessionId: "t", costUsd: 0.5 } }) + "\n");
    const l = new Ledger(dir, "ruki");
    expect(() => l.compact(now, 0)).toThrow(/retain/i);
    expect(() => l.compact(now, Number.NaN)).toThrow(/retain/i);
    l.compact(now, 90);
    expect(new Ledger(dir, "ruki").spentToday(now)).toBeCloseTo(0.5);
  });

  it("tracks spend per day", () => {
    const l = new Ledger(undefined, "x");
    const turn = { sessionId: "s", channel: "chat", user: "", reply: "", tools: [], handoff: false, model: "m", inputTokens: 0, outputTokens: 0, ms: 1 };
    l.logTurn({ ...turn, at: new Date().toISOString(), costUsd: 0.01 });
    l.logTurn({ ...turn, at: "2020-01-01T00:00:00Z", costUsd: 5 });
    expect(l.spentToday()).toBeCloseTo(0.01);
  });
});

describe("guardrails and cost", () => {
  it("rate limits per visitor and resets after the window", () => {
    const r = new RateLimiter(2, 1000);
    expect([r.allow("a", 0), r.allow("a", 1), r.allow("a", 2), r.allow("b", 2)]).toEqual([true, true, false, true]);
    expect(r.allow("a", 1001)).toBe(true);
  });
  it("prices tokens per model", () => {
    expect(costUsd("anthropic:claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e5 })).toBeCloseTo(3);
    expect(costUsd("mock", { input_tokens: 1e6, output_tokens: 1e6 })).toBe(0);
  });
});

describe("owner dashboard", () => {
  it("builds the prep list and per-window pickup sheet", () => {
    const s = new RestaurantStore(ruki);
    order(s, "syrniki", 3, "10:00");
    order(s, "syrniki", 2, "10:30");
    const sum = summary(ruki, s, new Ledger(undefined, "ruki"), { perMinute: 10, turnsPerSession: 30, dailyBudgetUsd: 2 });
    expect(sum.prep.find((p) => p.id === "syrniki")).toMatchObject({ sold: 5, batch: 40, remaining: 35 });
    expect(sum.kpis).toMatchObject({ orders: 2, revenue: 60 });
    expect(sum.windows.find((w) => w.time === "10:00")?.orders[0].items).toBe("3× Babushka's Syrniki");
  });
  it("exports CSV that a spreadsheet can't be tricked by", () => {
    const s = new RestaurantStore(ruki);
    s.placeOrder({ name: "=HYPERLINK(\"x\")", phone: "510-555-0100", items: [{ item: "tea", quantity: 1 }], pickupTime: "10:00" }, BEFORE_CUTOFF);
    const csv = ordersCsv(s);
    expect(csv.split("\n")[1]).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

it("ships every restaurant config with valid menus", () => {
  for (const id of ["ruki"]) {
    const c = loadRestaurant(id);
    expect(new Set(c.menu.map((m) => m.id)).size).toBe(c.menu.length);
    expect(JSON.parse(readFileSync(`data/restaurants/${id}.json`, "utf8")).id).toBe(id);
  }
});
