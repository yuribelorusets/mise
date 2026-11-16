import { describe, it, expect } from "vitest";
import { explode } from "../../../src/kitchen/plan.js";
import { totals, onHand } from "../../../src/kitchen/stock.js";
import { runKitchenTool, KITCHEN_TOOLS } from "../../../src/kitchen/assistant/tools.js";
import { ctx, ev, ruki, saturday } from "./fixtures.js";

describe("kitchen read tools", () => {
  it("has no tool that books or confirms anything", () => {
    expect(KITCHEN_TOOLS.map((t) => t.name).sort()).toEqual(["cost", "find_item", "max_batch", "offer_new_item", "on_hand", "prep_list", "propose_stock_changes", "shopping_list"]);
    expect(runKitchenTool("confirm_proposal", { id: "p-1" }, ctx()).isError).toBe(true);
  });

  it("finds an item by an alias, and says plainly when it doesn't know one", () => {
    expect(runKitchenTool("find_item", { name: "творог" }, ctx()).content).toMatchObject({ found: true, item: { id: "farmers-cheese" } });
    expect(runKitchenTool("find_item", { name: "sumac" }, ctx()).content).toMatchObject({ found: false });
  });

  it("answers on hand by location, in base units", () => {
    const r = runKitchenTool("on_hand", { item: "Eggs" }, ctx([ev("eggs", 120)]));
    expect(r).toEqual({ isError: false, content: { item: "eggs", name: "Eggs", baseUnit: "each", total: 120, byLocation: { "walk-in": 120 } } });
  });

  it("gives the same shortfalls as explode for the next plan", () => {
    const c = ctx([ev("eggs", 12)]);
    const want = explode(c.store.catalog(), saturday.lines, totals(onHand(c.store.events()))).shopping;
    const got = runKitchenTool("shopping_list", {}, c).content as { date: string; lines: { item: string; buy: number }[] };
    expect(got.date).toBe("2026-12-05");
    expect(got.lines.map((l) => [l.item, l.buy])).toEqual(want.map((l) => [l.item, l.buy]));
  });

  it("names prep tasks by recipe", () => {
    const got = runKitchenTool("prep_list", {}, ctx()).content as { tasks: { recipe: string; recipeName: string }[] };
    expect(got.tasks.length).toBeGreaterThan(0);
    for (const t of got.tasks) expect(t.recipeName).toBe(ruki.recipes.find((r) => r.id === t.recipe)!.name);
  });

  it("works out max batch from stock, in orders", () => {
    expect(runKitchenTool("max_batch", { item: "syrniki" }, ctx()).content).toMatchObject({ item: "syrniki", unit: "order", max: 0 });
  });

  it("costs a batch from the latest prices", () => {
    const priced = ruki.items.map((i) => ev(i.id, 100000, "walk-in", { id: `r-${i.id}`, kind: "receive", unitCost: 0.01 }));
    const r = runKitchenTool("cost", { item: "syrniki", qty: 10, unit: "order" }, ctx(priced)).content as { cost: number; perUnit: number; missing: string[] };
    expect(r.missing).toEqual([]);
    expect(r.perUnit).toBeCloseTo(r.cost / 10, 2);
  });

  it("explains a unit that doesn't convert", () => {
    const r = runKitchenTool("cost", { item: "eggs", qty: 2, unit: "kg" }, ctx());
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toMatch(/kg/);
  });
});
