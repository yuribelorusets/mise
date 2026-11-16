/**
 * Checks the web fixtures against what the kitchen core really returns, so the screens aren't built
 * against shapes the API won't send. Moved out of security-backlog.test.ts in wave 2.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { explode } from "../src/kitchen/plan.js";
import type { Catalog } from "../src/kitchen/types.js";
import { prepTasks } from "../web/src/fixtures/ruki.js";
const rukiKitchen: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));

describe("web fixtures against the kitchen core", () => {
  // Backlog: "The Today fixtures don't match what the kitchen core returns."
  it("names prep tasks the way explode does, by recipe id", () => {
    const real = explode(rukiKitchen as Catalog, [{ item: "syrniki", qty: 40, unit: "order", source: "preorder" }], {}).prep;
    const ids = new Set(rukiKitchen.recipes.map((r) => r.id));
    expect(real.every((t) => ids.has(t.recipe))).toBe(true); // what the API will send
    expect(prepTasks.every((t) => /^[a-z0-9-]+$/.test(t.recipe))).toBe(true); // what the screen was built against
  });
});
