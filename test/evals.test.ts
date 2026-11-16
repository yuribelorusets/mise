import { describe, it, expect } from "vitest";
import { loadScenarios, runScenario, runAll, SpendMeter, type ScenarioResult } from "../src/evals/run.js";
import { simulatedGuest } from "../src/evals/simulate.js";

// CI gate: the full scenario suite must pass on the offline mock, so a refactor
// that breaks tools, graders or the agent loop fails the build.
describe("eval suite (mock)", async () => {
  process.env.MISE_TODAY = "2026-12-04";
  const scenarios = await loadScenarios();
  it("has scenarios in English and Russian, the languages Ruki's guests use", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    const langs = new Set(scenarios.map((s) => s.expect?.language).filter(Boolean));
    for (const l of ["en", "ru"]) expect(langs).toContain(l);
  });
  for (const s of scenarios)
    it(s.id, async () => {
      const r = await runScenario(s, { label: "mock", llm: "mock" });
      expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    });
});

it("skips scenarios tagged live on the mock instead of faking a pass", async () => {
  const r = await runScenario({ id: "needs-claude", restaurant: "ruki", tags: ["live"], turns: ["hi"], expect: { reply_matches: ["never"] } }, { label: "mock", llm: "mock" });
  expect(r.skipped).toBe(true);
});

it("stops spending once the cap is reached", () => {
  const m = new SpendMeter(0.05);
  m.add("anthropic:claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 }); // $0.01
  expect(m.exceeded).toBe(false);
  m.add("anthropic:claude-sonnet-5-5", { input_tokens: 20_000, output_tokens: 1_000 }); // $0.05
  expect(m.exceeded).toBe(true);
  expect(m.spent).toBeCloseTo(0.06, 5);
});

describe("spend cap", () => {
  it("refuses a cap that isn't a usable number", () => {
    expect(() => new SpendMeter(Number.NaN)).toThrow(/cap/i);
    expect(() => new SpendMeter(-1)).toThrow(/cap/i);
    expect(() => new SpendMeter(Infinity)).toThrow(/cap/i);
    expect(() => new SpendMeter()).not.toThrow();
  });

  it("stops the run loop once the cap is reached", async () => {
    const scenarios = ["a", "b", "c", "d", "e"].map((id) => ({ id, expect: {} }));
    const ran: string[] = [];
    const fake = async (s: { id: string }) => {
      ran.push(s.id);
      return { id: s.id, pass: true, checks: [], tags: [], variant: "v", trial: 1, usage: { input_tokens: 0, output_tokens: 0 }, model: "mock", extraUsd: 0.02 } as unknown as ScenarioResult;
    };
    const meter = new SpendMeter(0.05);
    const { results, stopped } = await runAll(scenarios, [{ label: "v", llm: "mock" }], 1, fake, meter);
    expect(stopped).toBe(true);
    expect(ran).toEqual(["a", "b", "c"]);
    expect(results).toHaveLength(3);
    expect(meter.spent).toBeCloseTo(0.06);
  });

  it("counts the simulated guest's own model calls", async () => {
    const llm = { name: "anthropic:claude-haiku-5-5", complete: async () => ({ content: [{ type: "text" as const, text: "hi" }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 } }) };
    const guest = simulatedGuest(llm, { persona: "p", goal: "g" });
    await guest.next();
    await guest.next("hello");
    expect(guest.usage).toEqual({ input_tokens: 200, output_tokens: 20 });
  });
});

describe("kitchen scenarios", () => {
  const receive = (base: number) => ({
    id: "kitchen-inline", kitchen: "ruki", turns: ["two cases eggs and 5 kg flour came in"],
    expect: { kitchen_end_state: { proposals: 1, lines: [{ item: "eggs", base }, { item: "flour", base: 5000 }], events_written: 0 } },
  });

  it("grades the proposals a conversation left, in base units", async () => {
    const r = await runScenario(receive(360), { label: "mock", llm: "mock" });
    expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    expect(r.checks.length).toBeGreaterThan(0);
  });

  it("fails when a line's amount is wrong", async () => {
    const r = await runScenario(receive(180), { label: "mock", llm: "mock" });
    expect(r.pass).toBe(false);
  });

  it("starts from the stock and plans in setup", async () => {
    const r = await runScenario({
      id: "kitchen-setup", kitchen: "ruki", turns: ["what am I short for Saturday?"],
      setup: { plans: [{ id: "sat", date: "2026-12-05", lines: [{ item: "syrniki", qty: 40, unit: "order", source: "manual" }] }], stock: [{ kind: "count", item: "eggs", location: "walk-in", qty: 12 }] },
      expect: { tools_called: [{ name: "shopping_list" }], kitchen_end_state: { reply_numbers_from: "shopping_list", proposals: 0 } },
    }, { label: "mock", llm: "mock" });
    expect(r.checks.filter((c) => !c.pass)).toEqual([]);
  });

  it("fails a reply with a number no tool gave", async () => {
    const r = await runScenario({
      id: "kitchen-numbers", kitchen: "ruki", turns: ["how many eggs do I have"],
      setup: { stock: [{ kind: "count", item: "eggs", location: "walk-in", qty: 12 }] },
      expect: { kitchen_end_state: { reply_numbers_from: "shopping_list" } },
    }, { label: "mock", llm: "mock" });
    expect(r.pass).toBe(false);
  });
});
