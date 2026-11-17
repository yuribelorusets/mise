import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { explode, roundEachUp } from "../../src/kitchen/plan.js";
import { maxBatch } from "../../src/kitchen/cost.js";
import type { PlanLine } from "../../src/kitchen/types.js";
import { syrnikiCatalog as c } from "./fixtures.js";

const plan = (qty: number): PlanLine[] => [{ item: "syrniki", qty, unit: "order", source: "manual" }];

describe("explode", () => {
  it("turns a plan into prep tasks and a shopping list when nothing's on hand", () => {
    const r = explode(c, plan(40), {});
    expect(r.prep).toEqual([
      { recipe: "syrniki", item: "syrniki", qty: 120, batches: 40 },
      { recipe: "batter", item: "batter", qty: 6000, batches: 3 },
    ]);
    expect(r.shopping).toEqual([
      { item: "cheese", need: 3000, have: 0, buy: 3000 },
      { item: "eggs", need: 12, have: 0, buy: 12, buyUnit: "case", buyQty: 1, buyUnitBase: 180, buyBase: 180 },
    ]);
  });
  it("uses prepped stock before making more", () => {
    const r = explode(c, plan(40), { batter: 4500, cheese: 10000, eggs: 100 });
    expect(r.prep.find((p) => p.item === "batter")).toEqual({ recipe: "batter", item: "batter", qty: 1500, batches: 0.75 });
    expect(r.shopping).toEqual([]);
    expect(r.uses).toMatchObject({ batter: 4500, cheese: 750, eggs: 3 });
  });
  it("shares stock across lines instead of counting it twice", () => {
    const r = explode(c, [...plan(20), ...plan(20)], { batter: 3000 });
    expect(r.prep.find((p) => p.item === "batter")?.qty).toBe(3000);
  });
  it("needs twice as much for twice the plan, and never asks to buy a negative amount", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), (q) => {
      const one = explode(c, plan(q), {});
      const two = explode(c, plan(2 * q), {});
      const oneNeed = new Map(one.shopping.map((s) => [s.item, s.need]));
      return two.shopping.length === one.shopping.length
        && two.shopping.every((s) => Math.abs(s.need - 2 * (oneNeed.get(s.item) ?? Number.NaN)) < 1e-6 && s.buy >= 0);
    }));
  });
  it("treats a negative amount on hand as nothing", () => {
    const r = explode(c, plan(40), { cheese: -500, eggs: -1 });
    expect(r.shopping).toEqual([
      { item: "cheese", need: 3000, have: 0, buy: 3000 },
      { item: "eggs", need: 12, have: 0, buy: 12, buyUnit: "case", buyQty: 1, buyUnitBase: 180, buyBase: 180 },
    ]);
    expect(r.uses).toEqual({});
  });
  it("needs nothing when everything is on hand", () => {
    const r = explode(c, plan(10), { syrniki: 30 });
    expect(r.prep).toEqual([]);
    expect(r.shopping).toEqual([]);
  });
});

describe("roundEachUp", () => {
  it("rounds what's needed and what's bought up to whole units for things counted each", () => {
    const r = roundEachUp(c, explode(c, plan(45), { eggs: 6 }).shopping);
    expect(r).toContainEqual(expect.objectContaining({ item: "eggs", need: 14, have: 6, buy: 8, buyQty: 1 }));
  });
  it("leaves weights and what's on hand as they are", () => {
    const r = roundEachUp(c, explode(c, plan(45), { eggs: 5.5, cheese: 0.5 }).shopping);
    expect(r).toEqual([
      { item: "cheese", need: 3375, have: 0.5, buy: 3374.5 },
      { item: "eggs", need: 14, have: 5.5, buy: 8, buyUnit: "case", buyQty: 1, buyUnitBase: 180, buyBase: 180 },
    ]);
  });
  it("doesn't round float error up to another egg", () => {
    const [line] = roundEachUp(c, [{ item: "eggs", need: 12.000000000001, have: 0, buy: 12.000000000001 }]);
    expect(line).toMatchObject({ need: 12, buy: 12 });
  });
});

describe("shopping rounding", () => {
  const eggs = (qty: number) => explode(c, [{ item: "eggs", qty, unit: "each", source: "manual" }], {}).shopping[0];
  it("rounds up to whole cases", () => {
    expect(eggs(181).buyQty).toBe(2);
    expect(eggs(360).buyQty).toBe(2);
    expect(eggs(180).buyQty).toBe(1);
  });
  it("says how big the buy unit is and how much is bought", () => {
    expect(eggs(12)).toMatchObject({ buyQty: 1, buyUnitBase: 180, buyBase: 180 });
    expect(eggs(181)).toMatchObject({ buyQty: 2, buyUnitBase: 180, buyBase: 360 });
  });
  it("always buys at least one unit when there is a shortage", () => {
    const line = eggs(1e-8);
    expect(line.buy).toBeGreaterThan(0);
    expect(line.buyQty).toBeGreaterThanOrEqual(1);
  });
  // Batter makes 3000 g from 1000 g cheese, so batches are thirds and the float error is real.
  const thirds = structuredClone(c);
  thirds.recipes[0].yield.qty = 3000;
  thirds.recipes[0].components = [{ item: "cheese", qty: 1000, unit: "g" }];
  it("sees no shortage when what's on hand exactly equals the need, even for huge plans", () => {
    // n orders need 150 n g of batter, so 50 n g of cheese
    fc.assert(fc.property(fc.integer({ min: 1, max: 50_000_000 }), (n) =>
      explode(thirds, plan(n), { cheese: 50 * n }).shopping.length === 0), { numRuns: 2000 });
    expect(explode(thirds, plan(1e7), { cheese: 5e8 }).shopping).toEqual([]);
  });
  it("max batch isn't one short because of float error", () => {
    expect(maxBatch(thirds, { cheese: 5e8 }, "syrniki", "order", 20_000_000)).toBe(1e7);
  });
});

describe("explode on a bad catalog", () => {
  it("throws on a recipe cycle instead of overflowing the stack", () => {
    const bad = structuredClone(c);
    bad.recipes.push({ id: "cheese", name: "Cheese", makes: "cheese", yield: { qty: 1000, unit: "g" }, components: [{ item: "batter", qty: 100, unit: "g" }] });
    expect(() => explode(bad, plan(1), {})).toThrow(/cycle/i);
  });
  it("throws on a recipe that yields nothing", () => {
    const bad = structuredClone(c);
    bad.recipes[0].yield.qty = 0;
    expect(() => explode(bad, plan(1), {})).toThrow(/yield/i);
  });
});
