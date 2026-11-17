import { describe, it, expect } from "vitest";
import { batchCost, maxBatch } from "../../src/kitchen/cost.js";
import { syrnikiCatalog as c } from "./fixtures.js";
import type { Catalog, StockEvent } from "../../src/kitchen/types.js";

const receive = (item: string, qty: number, unitCost: number): StockEvent =>
  ({ id: item, at: "2026-12-01T10:00:00Z", kind: "receive", item, location: "walk-in", qty, unitCost, source: "manual" });

describe("cost", () => {
  it("prices a batch from the latest price paid for each raw ingredient", () => {
    const events = [receive("cheese", 1000, 0.012), receive("eggs", 180, 0.05)];
    // 10 orders: 1500 g batter = 0.75 batches = 750 g cheese ($9.00) + 3 eggs ($0.15)
    expect(batchCost(c, events, "syrniki", 10, "order")).toEqual({ cost: 9.15, missing: [] });
  });
  it("lists ingredients with no known price", () => {
    expect(batchCost(c, [receive("cheese", 1000, 0.012)], "syrniki", 10, "order").missing).toEqual(["eggs"]);
  });
  it("says how many whole units you can make from what's on hand", () => {
    expect(maxBatch(c, { cheese: 3000, eggs: 100 }, "syrniki", "order")).toBe(40);
    expect(maxBatch(c, { cheese: 3000, eggs: 8 }, "syrniki", "order")).toBe(26);
    expect(maxBatch(c, {}, "syrniki", "order")).toBe(0);
  });

  it("returns Infinity when stock doesn't limit the batch", () => {
    const water: Catalog = {
      items: [{ id: "tea", name: "Tea", aliases: [], baseUnit: "each", units: {}, allergens: [] }],
      locations: [], plans: [],
      recipes: [{ id: "tea", name: "Tea", makes: "tea", yield: { qty: 1, unit: "each" }, components: [] }],
    };
    expect(maxBatch(water, {}, "tea", "each")).toBe(Infinity);
    expect(maxBatch(c, { cheese: 1e9, eggs: 1e9 }, "syrniki", "order")).toBe(Infinity);
    expect(maxBatch(c, { cheese: 3000, eggs: 100 }, "syrniki", "order")).toBe(40);
  });

  it("refuses a search limit that isn't a positive whole number", () => {
    for (const limit of [Number.NaN, 0, -1, 1.5, Infinity]) expect(() => maxBatch(c, {}, "syrniki", "order", limit)).toThrow(RangeError);
  });
});
