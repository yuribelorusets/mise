import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { preorderLines, planLines, orderCapacity } from "../../src/kitchen/preorders.js";
import { loadRestaurant, type Order } from "../../src/domain/restaurant.js";
import { syrnikiCatalog } from "./fixtures.js";
import type { Catalog, PlanLine, ProductionPlan } from "../../src/kitchen/types.js";

const menu = loadRestaurant("ruki").menu;
const order = (items: [string, number][], pickupDate = "2026-12-05", over: Partial<Order> = {}): Order => ({
  id: `RK-${Math.random().toString(36).slice(2, 8)}`, name: "Anna", phone: "5105550101", total: 0, pickupDate, pickupTime: "11:00",
  items: items.map(([id, quantity]) => ({ id, name: id, quantity, price: 12 })), ...over,
});

describe("preorders in the plan", () => {
  it("adds up orders for the date into kitchen units", () => {
    const lines = preorderLines([order([["syrniki", 2]]), order([["syrniki", 3], ["black-tea", 1]]), order([["syrniki", 9]], "2026-12-12")], menu, "2026-12-05");
    expect(lines).toEqual([{ item: "syrniki", qty: 5, unit: "order", source: "preorder" }]);
  });

  it("keeps the plan's own lines and adds preorders after them", () => {
    const plan: ProductionPlan = { id: "sat", date: "2026-12-05", lines: [{ item: "syrniki", qty: 10, unit: "order", source: "manual" }] };
    expect(planLines(plan, "2026-12-05", [order([["syrniki", 2]])], menu)).toEqual([
      { item: "syrniki", qty: 10, unit: "order", source: "manual" },
      { item: "syrniki", qty: 2, unit: "order", source: "preorder" },
    ]);
  });

  it("ignores preorder lines that somehow got stored in a plan", () => {
    const plan: ProductionPlan = { id: "sat", date: "2026-12-05", lines: [{ item: "syrniki", qty: 4, unit: "order", source: "preorder" }] };
    expect(planLines(plan, "2026-12-05", [], menu)).toEqual([]);
  });

  it("keeps the source each stored line already has", () => {
    const plan: ProductionPlan = { id: "sat", date: "2026-12-05", lines: [{ item: "syrniki", qty: 4, unit: "order", source: "production" as never }] };
    expect(planLines(plan, "2026-12-05", [], menu)).toEqual(plan.lines);
  });

  it("every menu item that names a kitchen item points at a real one", () => {
    const kitchen: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));
    for (const m of menu.filter((x) => x.makes)) expect(kitchen.items.some((i) => i.id === m.makes!.item), m.id).toBe(true);
  });
});

describe("what the kitchen can still sell", () => {
  const stockFor10 = { cheese: 750, eggs: 3 };
  const makes = { item: "syrniki", unit: "order" };
  const line = (qty: number, source: PlanLine["source"]): PlanLine => ({ item: "syrniki", qty, unit: "order", source });

  it("sells only what's left after the plan and earlier preorders", () => {
    expect(orderCapacity(syrnikiCatalog, stockFor10, [line(4, "manual"), line(3, "preorder")], makes)).toBe(3);
  });
  it("is the whole stock when nothing is planned", () => {
    expect(orderCapacity(syrnikiCatalog, stockFor10, [], makes)).toBe(10);
  });
  it("is 0 once the plan uses everything", () => {
    expect(orderCapacity(syrnikiCatalog, stockFor10, [line(12, "manual")], makes)).toBe(0);
  });
  it("doesn't read 12 kg of stock as unlimited", () => {
    const dough: Catalog = {
      items: [{ id: "flour", name: "Flour", aliases: [], baseUnit: "g", units: {}, allergens: [] }, { id: "dough", name: "Dough", aliases: [], baseUnit: "g", units: {}, allergens: [] }],
      locations: [], plans: [],
      recipes: [{ id: "dough", name: "Dough", makes: "dough", yield: { qty: 1, unit: "g" }, components: [{ item: "flour", qty: 1, unit: "g" }] }],
    };
    expect(orderCapacity(dough, { flour: 12000 }, [], { item: "dough", unit: "g" })).toBe(12000);
  });
  it("is Infinity when the recipe needs nothing on hand", () => {
    const tea: Catalog = {
      items: [{ id: "tea", name: "Tea", aliases: [], baseUnit: "each", units: {}, allergens: [] }], locations: [], plans: [],
      recipes: [{ id: "tea", name: "Tea", makes: "tea", yield: { qty: 1, unit: "each" }, components: [] }],
    };
    expect(orderCapacity(tea, {}, [], { item: "tea", unit: "each" })).toBe(Infinity);
  });
});
