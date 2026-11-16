import type { Item } from "./types";

/** The mockups' "now": Friday morning, the day before the pop-up. */
export const NOW = "2026-12-04T09:00:00";

export const stockLocations = [
  { id: "walk-in", name: "Walk-in" },
  { id: "dry-store", name: "Dry store" },
  { id: "freezer", name: "Freezer" },
];

export const items: Item[] = [
  { id: "farmers-cheese", name: "Farmer's cheese", baseUnit: "g", units: { lb: 454 }, par: 4000, shelfLifeDays: 7 },
  { id: "eggs", name: "Eggs", baseUnit: "each", units: { dozen: 12, flat: 30, case: 180 }, par: 72, shelfLifeDays: 28 },
  { id: "sour-cream", name: "Sour cream", baseUnit: "g", units: { tub: 900 }, par: 1000, shelfLifeDays: 10 },
  { id: "milk", name: "Whole milk", baseUnit: "ml", units: { gal: 3785 }, shelfLifeDays: 7 },
  { id: "butter", name: "Butter", baseUnit: "g", units: { lb: 454 }, par: 2000, shelfLifeDays: 60 },
  { id: "syrniki-batter", name: "Syrniki batter", baseUnit: "g", units: {}, shelfLifeDays: 2 },
  { id: "nalysnyky-batter", name: "Nalysnyky batter", baseUnit: "ml", units: {}, shelfLifeDays: 2 },
  { id: "cheese-filling", name: "Cheese filling", baseUnit: "g", units: {}, shelfLifeDays: 3 },
  { id: "flour", name: "Flour", baseUnit: "g", units: { lb: 454, bag: 11340 }, par: 10000 },
  { id: "sugar", name: "Sugar", baseUnit: "g", units: { lb: 454 }, par: 5000 },
  { id: "jam", name: "Jam", baseUnit: "g", units: { jar: 340, case: 4080 }, par: 1000 },
  { id: "salt", name: "Salt", baseUnit: "g", units: {} },
  { id: "vanilla", name: "Vanilla", baseUnit: "ml", units: {} },
  { id: "oil", name: "Sunflower oil", baseUnit: "ml", units: {}, par: 2000 },
  { id: "cherries-frozen", name: "Sour cherries, frozen", baseUnit: "g", units: { lb: 454 } },
  { id: "cherry-compote", name: "Sour cherry compote", baseUnit: "ml", units: {}, shelfLifeDays: 5 },
  { id: "syrniki", name: "Syrniki", baseUnit: "each", units: { order: 3 } },
  { id: "nalysnyky", name: "Nalysnyky", baseUnit: "each", units: { order: 2 } },
];

const byId = new Map(items.map((i) => [i.id, i]));

export const findItem = (id: string): Item | undefined => byId.get(id);
export const itemName = (id: string): string => byId.get(id)?.name ?? id;
export const locationName = (id: string): string => stockLocations.find((l) => l.id === id)?.name ?? id;

/** Units an amount of this item can be given in: its base unit, kg or L, then its own. */
export function unitsFor(id: string): string[] {
  const item = byId.get(id);
  if (!item) return ["each"];
  const metric = item.baseUnit === "g" ? ["g", "kg"] : item.baseUnit === "ml" ? ["ml", "L"] : ["each"];
  return [...metric, ...Object.keys(item.units)];
}

/** An amount in base units, or undefined when the unit doesn't fit the item. */
export function toBase(id: string, qty: number, unit: string): number | undefined {
  const item = byId.get(id);
  if (!item) return undefined;
  if (unit === item.baseUnit) return qty;
  if (unit === "kg" && item.baseUnit === "g") return qty * 1000;
  if (unit === "L" && item.baseUnit === "ml") return qty * 1000;
  const size = item.units[unit];
  return size === undefined ? undefined : qty * size;
}
