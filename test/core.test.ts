import { describe, it, expect, beforeAll } from "vitest";
import { createHmac } from "node:crypto";
import { RestaurantStore } from "../src/domain/restaurant.js";
import { runTool } from "../src/agent/tools.js";
import { WebhookClient, sign } from "../src/integrations/webhook.js";
import { validTwilioSignature, sayAndGather } from "../src/channels/twilio.js";
import { subset, grade } from "../src/evals/graders.js";
import { detectLang } from "../src/llm/lang.js";
import { runTurn } from "../src/agent/agent.js";
import { MockLLM } from "../src/llm/mock.js";

beforeAll(() => { process.env.MISE_TODAY = "2026-12-04"; });
const NOW = new Date("2026-12-04T18:00:00-08:00");
const ctx = (store = new RestaurantStore(), webhook = new WebhookClient({ url: "", fallbackFile: null })) =>
  ({ store, webhook, sessionId: "t", channel: "eval" as const, now: NOW });

describe("RestaurantStore", () => {
  it("rejects Mondays, off-hours and oversized parties", () => {
    const s = new RestaurantStore();
    expect(s.slotProblem("2026-12-07", "19:00", 2)).toBe("closed_that_day");
    expect(s.slotProblem("2026-12-05", "15:00", 2)).toBe("outside_hours");
    expect(s.slotProblem("2026-12-05", "19:00", 9)).toBe("party_too_large");
  });
  it("offers alternatives for a full slot and never double-books it", () => {
    const s = new RestaurantStore();
    const r = s.checkAvailability("2026-12-04", "19:00", 2);
    expect(r.available).toBe(false);
    expect(r.available === false && r.alternatives.length).toBeGreaterThan(0);
    expect(() => s.createReservation({ date: "2026-12-04", time: "19:00", partySize: 2, name: "A", phone: "510-555-0101" })).toThrow(/fully_booked/);
  });
  it("filters the menu by allergen", () => {
    const names = new RestaurantStore().searchMenu({ query: "*", excludeAllergens: ["peanuts"] }).map((m) => m.name);
    expect(names).not.toContain("Grilled Chicken Satay");
  });
});

describe("tools", () => {
  it("returns an error result (not a crash) for items that aren't on the menu", async () => {
    const out = await runTool("place_order", { name: "Sam", phone: "510-555-0100", items: [{ item: "tacos", quantity: 2 }] }, ctx());
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.content)).toMatch(/not on the menu/);
  });
  it("emits a CRM event when a reservation is created", async () => {
    const c = ctx();
    const out = await runTool("create_reservation", { date: "2026-12-05", time: "18:00", partySize: 2, name: "Jo", phone: "510-555-0100" }, c);
    expect(out.isError).toBe(false);
    expect(c.webhook.delivered.map((e) => e.type)).toEqual(["reservation.created"]);
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

describe("twilio", () => {
  const token = "12345", url = "https://mycompany.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
  const good = createHmac("sha1", token).update(url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("")).digest("base64");
  it("accepts a valid signature and rejects tampering", () => {
    expect(validTwilioSignature(token, good, url, params)).toBe(true);
    expect(validTwilioSignature(token, good, url, { ...params, Digits: "9999" })).toBe(false);
    expect(validTwilioSignature(token, undefined, url, params)).toBe(false);
  });
  it("escapes text in TwiML", () => {
    expect(sayAndGather("Fish & chips <3", "/voice/turn")).toContain("Fish &amp; chips &lt;3");
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
  it("books a table end to end across tool calls", async () => {
    const c = ctx();
    const session = { id: "s1", messages: [] };
    const r = await runTurn(new MockLLM(), session, "Table for 2 tomorrow at 6pm, my name is Jo, 510 555 0100", c);
    expect(r.toolCalls.map((t) => t.name)).toEqual(["check_availability", "create_reservation"]);
    expect(r.reply).toMatch(/FA-[A-Z0-9]{6}/);
    expect(c.store.reservations).toHaveLength(1);
  });
  it("stops after maxSteps and hands off instead of looping forever", async () => {
    const looping = { name: "loop", complete: async () => ({ content: [{ type: "tool_use" as const, id: "x", name: "search_menu", input: { query: "*" } }], stop_reason: "tool_use" }) };
    const r = await runTurn(looping, { id: "s2", messages: [] }, "hi", ctx(), 3);
    expect(r.handoff).toBe(true);
    expect(r.llmCalls).toBe(3);
  });
});
