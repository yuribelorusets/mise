import { describe, it, expect } from "vitest";
import { runKitchenTool } from "../../../src/kitchen/assistant/tools.js";
import { ctx } from "./fixtures.js";

describe("kitchen write tools", () => {
  it("makes an open proposal and writes no stock", () => {
    const c = ctx();
    const r = runKitchenTool("propose_stock_changes", { lines: [{ kind: "receive", item: "Eggs", qty: 2, unit: "cases", raw: "two cases eggs" }] }, c);
    expect(r.isError).toBe(false);
    expect(r.content).toMatchObject({ booked: false, lines: [{ name: "Eggs", base: 360, baseUnit: "each", location: "walk-in" }] });
    expect(c.store.events()).toHaveLength(0);
    expect(c.proposals.list("open")).toHaveLength(1);
    expect(c.proposed).toHaveLength(1);
  });

  it("refuses a line for an item it doesn't know, and names it", () => {
    const c = ctx();
    const r = runKitchenTool("propose_stock_changes", { lines: [{ kind: "receive", item: "sumac", qty: 3, unit: "kg" }] }, c);
    expect(r.isError).toBe(true);
    expect(r.content).toMatchObject({ unknown: ["sumac"] });
    expect(c.proposals.list()).toHaveLength(0);
  });

  it("offers a new item without adding it", () => {
    const c = ctx();
    const r = runKitchenTool("offer_new_item", { name: "Sumac", baseUnit: "g", raw: "3 kg sumac" }, c);
    expect(r.content).toMatchObject({ offered: true, added: false });
    expect(c.offers).toEqual([{ id: "sumac", name: "Sumac", baseUnit: "g", raw: "3 kg sumac" }]);
    expect(c.store.catalog().items.some((i) => /sumac/i.test(i.name))).toBe(false);
  });

  it("won't offer an item that exists or a unit that isn't a base unit", () => {
    expect(runKitchenTool("offer_new_item", { name: "eggs", baseUnit: "each" }, ctx()).isError).toBe(true);
    expect(runKitchenTool("offer_new_item", { name: "Dill", baseUnit: "bunch" }, ctx()).isError).toBe(true);
  });

  it("can't be talked into a huge or negative amount", () => {
    for (const qty of [-5, Number.NaN, "lots"]) {
      const c = ctx();
      expect(runKitchenTool("propose_stock_changes", { lines: [{ kind: "waste", item: "eggs", qty, unit: "each" }] }, c).isError).toBe(true);
      expect(c.proposals.list()).toHaveLength(0);
    }
  });
});
