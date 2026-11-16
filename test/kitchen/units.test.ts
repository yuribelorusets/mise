import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { factor, toBase, fromBase, UnitError } from "../../src/kitchen/units.js";
import type { Item } from "../../src/kitchen/types.js";

const item = (over: Partial<Item>): Item => ({ id: "x", name: "X", aliases: [], baseUnit: "g", units: {}, allergens: [], ...over });
const eggs = item({ id: "eggs", name: "Eggs", baseUnit: "each", units: { case: 180, flat: 30 } });
const flour = item({ id: "flour", name: "Flour" });
const stock = item({ id: "stock", name: "Stock", baseUnit: "ml" });

describe("units", () => {
  it("uses item-specific units", () => expect(toBase(eggs, 2, "case")).toBe(360));
  it("knows kitchen units for each dimension", () => {
    expect(toBase(eggs, 2, "dozen")).toBe(24);
    expect(toBase(flour, 1, "kg")).toBe(1000);
    expect(toBase(flour, 2, "lb")).toBeCloseTo(907.18, 1);
    expect(toBase(stock, 6, "qt")).toBeCloseTo(5678.1, 0);
  });
  it("is forgiving about case, spaces and plurals", () => {
    expect(toBase(eggs, 1, " Cases ")).toBe(180);
    expect(toBase(stock, 2, "quarts")).toBeCloseTo(1892.7, 0);
  });
  it("refuses units from another dimension, and bad amounts", () => {
    expect(() => toBase(flour, 1, "qt")).toThrow(UnitError);
    expect(() => toBase(flour, -1, "g")).toThrow(UnitError);
    expect(() => toBase(flour, Number.NaN, "g")).toThrow(UnitError);
    expect(() => toBase(flour, Infinity, "g")).toThrow(UnitError);
  });
  it("only knows its own unit names, not Object.prototype's", () => {
    for (const u of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(() => factor(flour, u)).toThrow(UnitError);
      expect(() => factor(eggs, u)).toThrow(UnitError);
    }
  });
  it("refuses a result that overflows", () => {
    expect(() => toBase(flour, 1e308, "kg")).toThrow(UnitError);
  });
  it("converts back to what it started with", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.constantFrom("g", "kg", "oz", "lb"), (q, u) =>
      Math.abs(fromBase(flour, toBase(flour, q, u), u) - q) <= 1e-9 * Math.max(1, q)));
  });
});
