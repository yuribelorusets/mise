import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { preorderLines, planLines } from "../../src/kitchen/preorders.js";
import { loadRestaurant, type Order } from "../../src/domain/restaurant.js";
import type { Catalog, ProductionPlan } from "../../src/kitchen/types.js";

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

  it("still counts an order after retention has removed the name", () => {
    expect(preorderLines([order([["syrniki", 2]], "2026-12-05", { name: "[removed]", phone: "" })], menu, "2026-12-05")).toHaveLength(1);
  });

  it("every menu item that names a kitchen item points at a real one", () => {
    const kitchen: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));
    for (const m of menu.filter((x) => x.makes)) expect(kitchen.items.some((i) => i.id === m.makes!.item), m.id).toBe(true);
  });
});
