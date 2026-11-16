import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateCatalog } from "../../src/kitchen/catalog.js";
import { explode } from "../../src/kitchen/plan.js";
import type { Catalog } from "../../src/kitchen/types.js";

const ruki: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));

describe("Ruki's catalog", () => {
  it("is valid", () => expect(validateCatalog(ruki)).toEqual([]));
  it("plans 40 orders of syrniki the way I'd write it by hand (draft recipes)", () => {
    const r = explode(ruki, [{ item: "syrniki", qty: 40, unit: "order", source: "manual" }], {});
    expect(r.prep.map((p) => [p.item, p.batches])).toEqual([["syrniki", 40], ["syrniki-batter", 3]]);
    expect(Object.fromEntries(r.shopping.map((s) => [s.item, s.need]))).toEqual({
      "farmers-cheese": 3000, eggs: 12, flour: 600, sugar: 240, "sour-cream": 1600, jam: 1200,
    });
  });
});
