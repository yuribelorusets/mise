import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { onHand, total, totals, latestUnitCost } from "../../src/kitchen/stock.js";
import type { StockEvent } from "../../src/kitchen/types.js";

let n = 0;
const ev = (e: Partial<StockEvent> & Pick<StockEvent, "kind" | "qty">): StockEvent =>
  ({ id: `e${n++}`, at: "2026-12-01T10:00:00Z", item: "eggs", location: "walk-in", source: "manual", ...e });

describe("onHand", () => {
  it("adds receives, subtracts use and waste, and moves between locations", () => {
    const oh = onHand([ev({ kind: "receive", qty: 180 }), ev({ kind: "use", qty: 24 }), ev({ kind: "waste", qty: 6 }), ev({ kind: "move", qty: 30, to: "line" })]);
    expect(oh.eggs).toEqual({ "walk-in": 120, line: 30 });
    expect(total(oh, "eggs")).toBe(150);
  });
  it("lets a count set the amount outright", () => {
    const oh = onHand([ev({ kind: "receive", qty: 180 }), ev({ kind: "count", qty: 50 }), ev({ kind: "use", qty: 10 })]);
    expect(total(oh, "eggs")).toBe(40);
  });
  it("forgets everything before a count, whatever came before", () => {
    const anyEvent = fc.record({ kind: fc.constantFrom("receive" as const, "use" as const, "waste" as const), qty: fc.nat(1000) });
    fc.assert(fc.property(fc.array(anyEvent), fc.nat(1000), (before, counted) =>
      total(onHand([...before.map((e) => ev(e)), ev({ kind: "count", qty: counted })]), "eggs") === counted));
  });
  it("reports totals per item and the latest price paid", () => {
    const events = [ev({ kind: "receive", qty: 180, unitCost: 0.02 }), ev({ kind: "receive", qty: 180, unitCost: 0.025 }), ev({ kind: "receive", item: "flour", qty: 1000 })];
    expect(totals(onHand(events))).toEqual({ eggs: 360, flour: 1000 });
    expect(latestUnitCost(events, "eggs")).toBe(0.025);
    expect(latestUnitCost(events, "flour")).toBeUndefined();
  });
});
