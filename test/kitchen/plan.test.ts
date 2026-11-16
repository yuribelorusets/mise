import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { explode } from "../../src/kitchen/plan.js";
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
      { item: "eggs", need: 12, have: 0, buy: 12, buyUnit: "case", buyQty: 1 },
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
      return two.shopping.every((s, i) => Math.abs(s.need - 2 * one.shopping[i].need) < 1e-6 && s.buy >= 0);
    }));
  });
  it("needs nothing when everything is on hand", () => {
    const r = explode(c, plan(10), { syrniki: 30 });
    expect(r.prep).toEqual([]);
    expect(r.shopping).toEqual([]);
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
