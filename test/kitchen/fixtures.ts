import type { Catalog } from "../../src/kitchen/types.js";

export const syrnikiCatalog: Catalog = {
  items: [
    { id: "cheese", name: "Farmer's cheese", aliases: [], baseUnit: "g", units: {}, allergens: [] },
    { id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: { case: 180 }, allergens: [] },
    { id: "batter", name: "Batter", aliases: [], baseUnit: "g", units: {}, allergens: [] },
    { id: "syrniki", name: "Syrniki", aliases: [], baseUnit: "each", units: { order: 3 }, allergens: [] },
  ],
  locations: [],
  recipes: [
    { id: "batter", name: "Batter", makes: "batter", yield: { qty: 2000, unit: "g" }, components: [{ item: "cheese", qty: 1000, unit: "g" }, { item: "eggs", qty: 4, unit: "each" }] },
    { id: "syrniki", name: "Syrniki", makes: "syrniki", yield: { qty: 1, unit: "order" }, components: [{ item: "batter", qty: 150, unit: "g" }] },
  ],
  plans: [],
};
