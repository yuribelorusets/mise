import { describe, it, expect } from "vitest";
import { loadScenarios, runScenario, SpendMeter } from "../src/evals/run.js";

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
