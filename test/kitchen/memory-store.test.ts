import { describe, it, expect } from "vitest";
import { MemoryStore } from "../../src/kitchen/memory-store.js";

const empty = { items: [], locations: [], recipes: [], plans: [] };

describe("MemoryStore", () => {
  it("appends events in order and returns a copy of the catalog", () => {
    const s = new MemoryStore(empty);
    s.append([{ id: "e1", at: "2026-12-01T10:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 180, source: "manual" }]);
    expect(s.events().map((e) => e.id)).toEqual(["e1"]);
    const c = s.catalog();
    c.items.push({ id: "x", name: "x", aliases: [], baseUnit: "g", units: {}, allergens: [] });
    expect(s.catalog().items).toHaveLength(0);
  });
});
