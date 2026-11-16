import { describe, it, expect } from "vitest";
import { loadScenarios, runScenario } from "../src/evals/run.js";

// CI gate: the full scenario suite must pass on the offline mock, so a refactor
// that breaks tools, graders or the agent loop fails the build.
describe("eval suite (mock)", async () => {
  process.env.MISE_TODAY = "2026-12-04";
  const scenarios = await loadScenarios();
  it("has scenarios in all four languages", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(12);
    const langs = new Set(scenarios.map((s) => s.expect?.language).filter(Boolean));
    for (const l of ["en", "es", "fr", "ru"]) expect(langs).toContain(l);
  });
  for (const s of scenarios)
    it(s.id, async () => {
      const r = await runScenario(s, { label: "mock", llm: "mock" });
      expect(r.checks.filter((c) => !c.pass)).toEqual([]);
    });
});
