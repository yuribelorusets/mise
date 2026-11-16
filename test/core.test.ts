import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { loadRestaurant, RestaurantStore } from "../src/domain/restaurant.js";
import { runTool } from "../src/agent/tools.js";
import { WebhookClient, sign } from "../src/integrations/webhook.js";
import { subset, grade } from "../src/evals/graders.js";
import { detectLang } from "../src/llm/lang.js";
import { runTurn } from "../src/agent/agent.js";
import { MockLLM } from "../src/llm/mock.js";

beforeAll(() => { process.env.MISE_TODAY = "2026-12-04"; });
const NOW = new Date("2026-12-04T18:00:00-08:00");
const ctx = (store = new RestaurantStore(), webhook = new WebhookClient({ url: "", fallbackFile: null })) =>
  ({ store, webhook, sessionId: "t", channel: "eval" as const, now: NOW });

describe("RestaurantStore", () => {
  it("filters the menu by allergen", () => {
    const names = new RestaurantStore().searchMenu({ query: "*", excludeAllergens: ["gluten"] }).map((m) => m.name);
    expect(names).toEqual(["Black Tea with Jam"]);
  });
});

describe("tools", () => {
  it("returns an error result (not a crash) for items that aren't on the menu", async () => {
    const out = await runTool("place_order", { name: "Sam", phone: "510-555-0100", items: [{ item: "tacos", quantity: 2 }] }, ctx());
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toMatch(/not on the menu/);
  });
});

describe("webhook", () => {
  it("signs the exact body with HMAC-SHA256", () => {
    expect(sign("{}", "s")).toBe("sha256=" + createHmac("sha256", "s").update("{}").digest("hex"));
  });
  it("retries 5xx with backoff and stops on success", async () => {
    const statuses = [500, 503, 200];
    let calls = 0;
    const w = new WebhookClient({ url: "https://crm.example", baseDelayMs: 1, fetchImpl: async () => ({ ok: statuses[calls] === 200, status: statuses[calls++] }) });
    const r = await w.send(w.build("order.placed", "s", "chat", {}));
    expect(r).toMatchObject({ delivered: true, attempts: 3 });
  });
  it("does not retry 4xx", async () => {
    let calls = 0;
    const w = new WebhookClient({ url: "https://crm.example", baseDelayMs: 1, fetchImpl: async () => { calls++; return { ok: false, status: 400 }; } });
    expect((await w.send(w.build("order.placed", "s", "chat", {}))).delivered).toBe(false);
    expect(calls).toBe(1);
  });
});

describe("graders", () => {
  it("matches tool inputs as subsets, case-insensitively", () => {
    expect(subset({ name: "lucía", partySize: 4 }, { name: "Lucía", partySize: 4, phone: "510-555-0101" })).toBe(true);
    expect(subset({ excludeAllergens: ["gluten"] }, { excludeAllergens: ["dairy", "gluten"] })).toBe(true);
    expect(subset({ time: "19:00" }, { time: "19:30" })).toBe(false);
  });
  it("detects the reply language", () => {
    expect(detectLang("Здравствуйте, ваш столик готов")).toBe("ru");
    expect(detectLang("¡Hola! Su mesa está lista, gracias")).toBe("es");
    expect(detectLang("Bonjour, votre table est prête, merci")).toBe("fr");
    expect(detectLang("Your table is ready, thanks for booking")).toBe("en");
  });
  it("fails a reply that recommends an allergen", () => {
    const checks = grade({ reply_must_not_include: ["Satay"] }, "Try the Grilled Chicken Satay!", [], []);
    expect(checks[0].pass).toBe(false);
  });
});

describe("agent loop", () => {
  it("places a preorder end to end across tool calls", async () => {
    const config = loadRestaurant("ruki");
    const c = ctx(new RestaurantStore(config));
    const llm = new MockLLM(config);
    const session = { id: "s1", messages: [] };
    await runTurn(llm, session, "Can I preorder 2 syrniki and a black tea?", c);
    await runTurn(llm, session, "11:30", c);
    const r = await runTurn(llm, session, "Sam, 510-555-0202", c);
    expect(r.toolCalls.map((t) => t.name)).toContain("place_order");
    expect(r.reply).toMatch(/RK-[A-Z0-9]{6}/);
    expect(c.store.orders).toHaveLength(1);
    expect(c.store.orders[0].total).toBe(28);
  });
  it("stops after maxSteps and hands off instead of looping forever", async () => {
    const looping = { name: "loop", complete: async () => ({ content: [{ type: "tool_use" as const, id: "x", name: "search_menu", input: { query: "*" } }], stop_reason: "tool_use" }) };
    const r = await runTurn(looping, { id: "s2", messages: [] }, "hi", ctx(), 3);
    expect(r.handoff).toBe(true);
    expect(r.llmCalls).toBe(3);
  });
});
