import { describe, it, expect } from "vitest";
import { validateCatalog, findItem } from "../../src/kitchen/catalog.js";
import type { Catalog } from "../../src/kitchen/types.js";

const base = (): Catalog => ({
  items: [
    { id: "cheese", name: "Farmer's cheese", aliases: ["tvorog", "творог"], baseUnit: "g", units: {}, allergens: ["dairy"] },
    { id: "batter", name: "Syrniki batter", aliases: [], baseUnit: "g", units: {}, allergens: ["dairy"] },
  ],
  locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: ["cheese", "batter"] }],
  recipes: [{ id: "batter", name: "Batter", makes: "batter", yield: { qty: 2, unit: "kg" }, components: [{ item: "cheese", qty: 1, unit: "kg" }] }],
  plans: [],
});

describe("validateCatalog", () => {
  it("accepts a good catalog", () => expect(validateCatalog(base())).toEqual([]));
  it("refuses ids that aren't kebab-case", () => {
    const c = base();
    c.items.push({ id: "__proto__", name: "Odd", aliases: [], baseUnit: "g", units: {}, allergens: [] });
    c.locations.push({ id: "Walk In", name: "Walk-in 2", shelfOrder: [] });
    const errors = validateCatalog(c).join(" ");
    expect(errors).toMatch(/__proto__/);
    expect(errors).toMatch(/Walk In/);
  });
  it("names unknown items and units", () => {
    const c = base();
    c.recipes[0].components.push({ item: "sugar", qty: 1, unit: "g" }, { item: "cheese", qty: 1, unit: "qt" });
    expect(validateCatalog(c).join("\n")).toMatch(/sugar/);
    expect(validateCatalog(c).join("\n")).toMatch(/qt/);
  });
  it("rejects item unit factors that aren't positive finite numbers", () => {
    for (const bad of [-180, 0, Number.POSITIVE_INFINITY, Number.NaN]) {
      const c = base();
      c.items[0].units = { case: bad };
      expect(validateCatalog(c).join("\n")).toMatch(/case/);
    }
  });
  it("finds a recipe cycle", () => {
    const c = base();
    c.recipes.push({ id: "cheese", name: "Cheese", makes: "cheese", yield: { qty: 1, unit: "kg" }, components: [{ item: "batter", qty: 1, unit: "kg" }] });
    expect(validateCatalog(c).join("\n")).toMatch(/cycle/i);
  });
  it("rejects two recipes for one item, duplicate ids and zero yields", () => {
    const c = base();
    c.recipes.push({ ...c.recipes[0], id: "batter-2" }, { ...c.recipes[0], yield: { qty: 0, unit: "g" } });
    c.items.push({ ...c.items[0] });
    const errors = validateCatalog(c).join("\n");
    expect(errors).toMatch(/more than one recipe/i);
    expect(errors).toMatch(/duplicate/i);
    expect(errors).toMatch(/yield/i);
  });
});

describe("findItem", () => {
  it("matches names and aliases ignoring case", () => {
    expect(findItem(base(), "TVOROG")?.id).toBe("cheese");
    expect(findItem(base(), "творог")?.id).toBe("cheese");
    expect(findItem(base(), "farmer's cheese")?.id).toBe("cheese");
    expect(findItem(base(), "sugar")).toBeUndefined();
  });
});
