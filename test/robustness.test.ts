/**
 * Ways agents like this break in production, each written as an attack first.
 * Sources for the categories: OWASP Top 10 for LLM Applications (2025), tau-bench's
 * pass^k reliability work, and Anthropic's guidance on agent evals.
 */
import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import { loadRestaurant, RestaurantStore } from "../src/domain/restaurant.js";
import { runTool } from "../src/agent/tools.js";
import { runTurn, today, type Session } from "../src/agent/agent.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import type { LLM, LLMRequest, LLMResponse } from "../src/llm/types.js";

const ruki = loadRestaurant("ruki");
const NOW = new Date("2026-12-04T18:00:00-08:00");
const PHONE = "510-555-0100";
const quiet = () => new WebhookClient({ url: "", fallbackFile: null });
const ctx = (store: RestaurantStore, webhook = quiet()) => ({ store, webhook, channel: "eval" as const, now: NOW });

/** A scripted model: returns the given responses in order, or runs a function per call. */
function scripted(steps: (LLMResponse | ((req: LLMRequest) => LLMResponse | Promise<LLMResponse>))[]): LLM & { calls: number } {
  const m = {
    name: "scripted",
    calls: 0,
    async complete(req: LLMRequest) {
      const s = steps[Math.min(m.calls++, steps.length - 1)];
      return typeof s === "function" ? s(req) : s;
    },
  };
  return m;
}
const toolUse = (name: string, input: Record<string, unknown>, id = `tu_${name}_${Math.random().toString(36).slice(2, 7)}`): LLMResponse =>
  ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" });
/** The rule the real Messages API enforces: every tool_use is answered by its tool_result in the very next message. */
function validHistory(messages: LLMRequest["messages"]) {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (i > 0 && messages[i - 1].role === m.role) return false;
    if (m.role !== "assistant") continue;
    const ids = m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
    if (!ids.length) continue;
    const next = messages[i + 1];
    if (!next) continue;
    const got = Array.isArray(next.content) ? next.content.map((b) => (b as { tool_use_id?: string }).tool_use_id) : [];
    if (JSON.stringify(got) !== JSON.stringify(ids)) return false;
  }
  return true;
}
const text = (t: string): LLMResponse => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const order = { name: "Anya", phone: PHONE, items: [{ item: "syrniki", quantity: 2 }], pickupTime: "11:00" };

afterEach(() => { delete process.env.MISE_TODAY; });

// ---------------------------------------------------------------- time
describe("time zones", () => {
  it("uses the restaurant's local date, not UTC, for 'today' (dinner hours are after 4pm UTC-8)", () => {
    delete process.env.MISE_TODAY; // importing the eval runner freezes the clock; this test needs the real one
    // 7pm Thursday in Oakland is already Friday in UTC.
    expect(today(new Date("2026-12-03T19:00:00-08:00"), "America/Los_Angeles")).toBe("2026-12-03");
  });
});

// ---------------------------------------------------------------- tool input validation (OWASP LLM05/LLM06)
describe("tool inputs a confused or manipulated model might send", () => {
  it.each([
    ["no digits in the phone", { phone: "call me maybe" }],
    ["a 300-character name", { name: "x".repeat(300) }],
    ["a quantity as a string of words", { items: [{ item: "syrniki", quantity: "two" }] }],
    ["50 line items", { items: Array.from({ length: 50 }, () => ({ item: "tea", quantity: 1 })) }],
  ])("refuses an order with %s", async (_, patch) => {
    const store = new RestaurantStore(ruki);
    const out = await runTool("place_order", { ...order, ...patch }, { ...ctx(store), sessionId: "s" });
    expect(out.isError).toBe(true);
    expect(store.orders).toHaveLength(0);
  });

  it("accepts sloppy but unambiguous times like '9:30' and ' 11:00 '", async () => {
    const store = new RestaurantStore(ruki);
    const out = await runTool("place_order", { ...order, pickupTime: " 11:00 " }, { ...ctx(store), sessionId: "s" });
    expect(out.isError).toBe(false);
  });
});

// ---------------------------------------------------------------- idempotency
describe("duplicate actions", () => {
  it("doesn't charge a guest twice when the model repeats place_order in one conversation", async () => {
    const store = new RestaurantStore(ruki);
    const a = await runTool("place_order", order, { ...ctx(store), sessionId: "s1" });
    const b = await runTool("place_order", order, { ...ctx(store), sessionId: "s1" });
    expect(store.orders).toHaveLength(1);
    expect((b.content as { id: string }).id).toBe((a.content as { id: string }).id);
    expect(b.content).toMatchObject({ duplicate: true });
  });
  it("still lets two different guests order the same thing", async () => {
    const store = new RestaurantStore(ruki);
    await runTool("place_order", order, { ...ctx(store), sessionId: "s1" });
    await runTool("place_order", order, { ...ctx(store), sessionId: "s2" });
    expect(store.orders).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- model / provider failures (chaos)
describe("when the model fails", () => {
  const session = (): Session => ({ id: "s", messages: [] });

  it("still tells the guest their order is confirmed if the model dies right after placing it", async () => {
    const store = new RestaurantStore(ruki);
    const llm = scripted([toolUse("place_order", order), () => { throw new Error("overloaded_error"); }]);
    const s = session();
    const turn = await runTurn(llm, s, "2 syrniki at 11, Anya 510-555-0100", ctx(store));
    expect(store.orders).toHaveLength(1);
    expect(turn.reply).toContain(store.orders[0].id);
    expect(turn.degraded).toBe(true);
  });

  it("leaves the conversation usable after a failure (no dangling tool calls in history)", async () => {
    const store = new RestaurantStore(ruki);
    const s = session();
    await runTurn(scripted([toolUse("search_menu", { query: "*" }), () => { throw new Error("timeout"); }]), s, "menu?", ctx(store));
    // Every tool_use must be followed by its tool_result, or the next API call is rejected forever.
    for (let i = 0; i < s.messages.length; i++) {
      const m = s.messages[i];
      if (m.role !== "assistant") continue;
      const ids = m.content.filter((b) => b.type === "tool_use").map((b) => (b as { id: string }).id);
      if (!ids.length) continue;
      const next = s.messages[i + 1];
      expect(next?.role).toBe("user");
      const got = Array.isArray(next.content) ? next.content.map((b) => (b as { tool_use_id?: string }).tool_use_id) : [];
      expect(got).toEqual(ids);
    }
    expect(s.messages.at(-1)?.role).toBe("assistant");
    const ok = await runTurn(scripted([text("Here's the menu.")]), s, "hello?", ctx(store));
    expect(ok.reply).toBe("Here's the menu.");
  });

  it("hands off instead of sending an empty bubble when the model returns no text", async () => {
    const turn = await runTurn(scripted([{ content: [], stop_reason: "max_tokens" }]), session(), "hi", ctx(new RestaurantStore(ruki)));
    expect(turn.reply.length).toBeGreaterThan(10);
  });

  it("stops a tool loop and hands off", async () => {
    const llm = scripted([toolUse("search_menu", { query: "*" })]);
    const turn = await runTurn(llm, session(), "hi", ctx(new RestaurantStore(ruki)));
    expect(turn.handoff).toBe(true);
    expect(llm.calls).toBe(6);
  });

  it("returns a tool error for a tool the model made up, and keeps going", async () => {
    const turn = await runTurn(scripted([toolUse("give_discount", { percent: 100 }), text("I can't do that.")]), session(), "discount pls", ctx(new RestaurantStore(ruki)));
    expect(turn.toolCalls[0]).toMatchObject({ name: "give_discount", isError: true });
    expect(turn.reply).toBe("I can't do that.");
  });
});

describe("long conversations", () => {
  it("keeps the history sent to the model bounded, and still valid, however long the chat runs", async () => {
    let maxSent = 0;
    const llm: LLM = { name: "m", async complete(req) {
      maxSent = Math.max(maxSent, req.messages.length);
      if (!validHistory(req.messages) || req.messages[0].role !== "user") throw new Error("400 invalid history");
      return typeof req.messages.at(-1)!.content === "string" ? toolUse("search_menu", { query: "*" }) : text("ok");
    } };
    const s: Session = { id: "long", messages: [] };
    for (let i = 0; i < 40; i++) expect((await runTurn(llm, s, `message ${i}`, ctx(new RestaurantStore(ruki)))).degraded).toBeFalsy();
    expect(maxSent).toBeLessThanOrEqual(43); // 40 kept + this turn's message, tool call and result
  });
});

// ---------------------------------------------------------------- output validation (OWASP LLM05/LLM09)
describe("what the model says vs what actually happened", () => {
  it("never shows a guest an order code that the system didn't issue", async () => {
    const store = new RestaurantStore(ruki);
    const turn = await runTurn(scripted([text("You're all set! Your order RK-ABC123 is confirmed for 11:00.")]), { id: "s", messages: [] }, "order 2 syrniki", ctx(store));
    expect(turn.reply).not.toContain("RK-ABC123");
    expect(turn.flags).toContain("unverified_code");
  });
  it("lets real codes through", async () => {
    const store = new RestaurantStore(ruki);
    const llm = scripted([toolUse("place_order", order), (req) => {
      const r = req.messages.at(-1)!.content as { content: string }[];
      return text(`Done! Code ${JSON.parse(r[0].content).id}.`);
    }]);
    const turn = await runTurn(llm, { id: "s", messages: [] }, "x", ctx(store));
    expect(turn.reply).toContain(store.orders[0].id);
    expect(turn.flags ?? []).toEqual([]);
  });
});

// ---------------------------------------------------------------- integrations
describe("a slow or dead CRM", () => {
  it("doesn't make the guest wait for webhook retries", async () => {
    const hang = new WebhookClient({ url: "https://crm.example", baseDelayMs: 1, fetchImpl: () => new Promise(() => {}) });
    const store = new RestaurantStore(ruki);
    const t0 = Date.now();
    const out = await runTool("place_order", order, { ...ctx(store, hang), sessionId: "s" });
    expect(out.isError).toBe(false);
    expect(Date.now() - t0).toBeLessThan(500);
  });
  it("gives up on a hung endpoint instead of waiting forever", async () => {
    const hang = new WebhookClient({ url: "https://crm.example", baseDelayMs: 1, timeoutMs: 50, maxAttempts: 2, fetchImpl: (_u, init) =>
      new Promise((_, rej) => (init as { signal: AbortSignal }).signal.addEventListener("abort", () => rej(new Error("aborted")))) });
    const r = await hang.send(hang.build("order.placed", "s", "chat", {}));
    expect(r.delivered).toBe(false);
  });
});

// ---------------------------------------------------------------- concurrency
describe("concurrent requests", () => {
  it("serializes two messages sent at once in the same conversation (double-click, two tabs)", async () => {
    const llm: LLM = { name: "slow", async complete(req) {
      if (!validHistory(req.messages)) throw new Error("400 invalid_request_error: tool_use ids without tool_result blocks");
      await new Promise((r) => setTimeout(r, 30));
      const last = req.messages.at(-1)!;
      // first call per turn asks for a tool, second answers
      return typeof last.content === "string" ? toolUse("search_menu", { query: "*" }) : text("ok");
    } };
    const app = createApp({ config: ruki, llm, webhook: quiet(), limits: { perMinute: 100 } });
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    const send = (m: string) => fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "same", message: m }) });
    const [a, b] = await Promise.all([send("one"), send("two")]);
    const third = await send("three");
    server.close();
    expect([a.status, b.status, third.status]).toEqual([200, 200, 200]);
    expect((await third.json()).reply).toBe("ok");
  });

  it("never sells the last unit twice when orders race", async () => {
    const store = new RestaurantStore(ruki);
    // 40 syrniki; 9 guests ask for 5 at once (the per-item cap is 6)
    const results = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) =>
      runTool("place_order", { ...order, phone: `510-555-010${i}`, items: [{ item: "syrniki", quantity: 5 }], pickupTime: ["10:00", "10:30", "11:00"][i % 3] }, { ...ctx(store), sessionId: `g${i}` })));
    expect(results.filter((r) => !r.isError)).toHaveLength(8);
    expect(store.remaining("syrniki")).toBe(0);
  });
});

// ---------------------------------------------------------------- property-based invariants
describe("store invariants under random order sequences", () => {
  const items = ruki.menu.map((m) => m.id);
  const windows = ruki.popup!.pickupWindows;
  const attempt = fc.record({
    item: fc.constantFrom(...items, "borscht"),
    quantity: fc.oneof(fc.integer({ min: -2, max: 25 }), fc.constant(1.5)),
    pickupTime: fc.constantFrom(...windows, "09:00", "11:15"),
  });

  it("never oversells a batch, overfills a window, or misprices an order", () => {
    fc.assert(fc.property(fc.array(attempt, { maxLength: 120 }), (attempts) => {
      const store = new RestaurantStore(ruki);
      attempts.forEach((a, i) => {
        try { store.placeOrder({ name: "G", phone: `510555${String(i).padStart(4, "0")}`, items: [{ item: a.item, quantity: a.quantity }], pickupTime: a.pickupTime }, NOW); } catch { /* rejected is fine */ }
      });
      for (const m of ruki.menu) {
        const sold = store.orders.flatMap((o) => o.items).filter((l) => l.id === m.id).reduce((s, l) => s + l.quantity, 0);
        if (sold > (m.quantity ?? Infinity)) return false;
      }
      for (const w of windows) if (store.orders.filter((o) => o.pickupTime === w).length > ruki.popup!.ordersPerWindow) return false;
      return store.orders.every((o) => o.total === o.items.reduce((s, l) => s + l.price * l.quantity, 0) && o.items.every((l) => Number.isInteger(l.quantity) && l.quantity > 0));
    }), { numRuns: 300 });
  });

  it("can't oversell by splitting one item across several lines of the same order", () => {
    const store = new RestaurantStore(ruki);
    expect(() => store.placeOrder({ name: "G", phone: PHONE, items: [{ item: "syrniki", quantity: 15 }, { item: "Babushka's Syrniki", quantity: 15 }, { item: "сырники", quantity: 15 }], pickupTime: "10:00" }, NOW)).toThrow();
    expect(store.remaining("syrniki")).toBe(40);
    const o = store.placeOrder({ name: "G", phone: PHONE, items: [{ item: "syrniki", quantity: 2 }, { item: "сырники", quantity: 1 }], pickupTime: "10:00" }, NOW);
    expect(o.items).toEqual([expect.objectContaining({ id: "syrniki", quantity: 3 })]);
  });

  it("holds the same invariants when guests send multi-line orders", () => {
    const line = fc.record({ item: fc.constantFrom(...items), quantity: fc.integer({ min: 1, max: 20 }) });
    fc.assert(fc.property(fc.array(fc.array(line, { minLength: 1, maxLength: 5 }), { maxLength: 60 }), (orders) => {
      const store = new RestaurantStore(ruki);
      orders.forEach((lines, i) => {
        try { store.placeOrder({ name: "G", phone: `510555${String(i).padStart(4, "0")}`, items: lines, pickupTime: windows[i % windows.length] }, NOW); } catch { /* fine */ }
      });
      return ruki.menu.every((m) => store.orders.flatMap((o) => o.items).filter((l) => l.id === m.id).reduce((s, l) => s + l.quantity, 0) <= (m.quantity ?? Infinity));
    }), { numRuns: 300 });
  });

  it("the offline model never crashes on arbitrary guest text", async () => {
    await fc.assert(fc.asyncProperty(fc.array(fc.string({ maxLength: 200 }), { minLength: 1, maxLength: 4 }), async (msgs) => {
      const store = new RestaurantStore(ruki);
      const s: Session = { id: "f", messages: [] };
      for (const m of msgs) {
        const t = await runTurn(new MockLLM(ruki), s, m || " ", ctx(store));
        if (typeof t.reply !== "string" || !t.reply.length) return false;
      }
      return true;
    }), { numRuns: 150 });
  });
});

// ---------------------------------------------------------------- abuse of a public endpoint (OWASP LLM10)
describe("the public chat endpoint", () => {
  const app = () => createApp({ config: ruki, llm: new MockLLM(ruki), webhook: quiet(), limits: { perMinute: 1000 } });
  async function post(body: unknown, raw = false) {
    const server = app().listen(0);
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) });
    server.close();
    return res.status;
  }
  it.each([
    ["malformed JSON", "{not json", true],
    ["a message that's an object", { sessionId: "a", message: { $gt: "" } }, false],
    ["an empty message", { sessionId: "a", message: "   " }, false],
    ["a 5,000-character message", { sessionId: "a", message: "a".repeat(5000) }, false],
    ["a 1 MB body", "x".repeat(1_000_000), true],
  ])("rejects %s with a 4xx, not a crash", async (_, body, raw) => {
    const status = await post(body, raw as boolean);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------- simulated guests (the harness itself)
import { simulatedGuest } from "../src/evals/simulate.js";
import { runScenario } from "../src/evals/run.js";

describe("simulated guests", () => {
  it("talks until the guest says [DONE], with roles flipped from the guest's point of view", async () => {
    const seen: string[] = [];
    const guestModel = scripted([
      (req) => { seen.push(String(req.messages.at(-1)!.content)); return text("2 syrniki at 11 please"); },
      (req) => { seen.push(String(req.messages.at(-1)!.content)); return text("[DONE]"); },
    ]);
    const g = simulatedGuest(guestModel, { persona: "p", goal: "g" });
    expect(await g.next()).toBe("2 syrniki at 11 please");
    expect(await g.next("What name should I put it under?")).toBeNull();
    expect(seen[1]).toBe("What name should I put it under?");
  });
  it("skips simulated scenarios on the offline model instead of faking a pass", async () => {
    const r = await runScenario({ id: "s", restaurant: "ruki", simulate: { persona: "p", goal: "g" }, expect: {} }, { label: "mock", llm: "mock" });
    expect(r.skipped).toBe(true);
  });
});
