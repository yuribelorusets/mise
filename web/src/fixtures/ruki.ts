// Mockup data for Saturday's pop-up. Shapes follow the kitchen core's results;
// amounts are in base units (g, ml, each).

export type BaseUnit = "g" | "ml" | "each";

export interface PrepTask {
  recipe: string;
  item: string;
  qty: number;
  batches: number;
}

export interface ShoppingLine {
  item: string;
  need: number;
  have: number;
  buy: number;
  buyUnit?: string;
  buyQty?: number;
}

export interface Preorder {
  id: string;
  name: string;
  window: string;
  items: { item: string; qty: number }[];
}

export interface CountItem {
  id: string;
  name: string;
  unit: string;
  step: number;
  last: number;
  shelf: string;
}

export const pickupDate = "Saturday 5 December";

export const targets = [
  { name: "Syrniki", qty: 40 },
  { name: "Nalysnyky", qty: 30 },
];

// Display names and base units for the item ids used below.
export const itemInfo: Record<string, { name: string; base: BaseUnit }> = {
  "syrniki-batter": { name: "Syrniki batter", base: "g" },
  "nalysnyky-batter": { name: "Nalysnyky batter", base: "ml" },
  "cheese-filling": { name: "Cheese filling", base: "g" },
  "cherry-compote": { name: "Sour cherry compote", base: "ml" },
  "herb-schmear": { name: "Dill schmear", base: "g" },
  "pickled-beets": { name: "Pickled beets", base: "g" },
  "farmers-cheese": { name: "Farmer's cheese", base: "g" },
  eggs: { name: "Eggs", base: "each" },
  "sour-cream": { name: "Sour cream", base: "g" },
};

export const prepTasks: PrepTask[] = [
  { recipe: "Syrniki batter", item: "syrniki-batter", qty: 4800, batches: 2 },
  { recipe: "Nalysnyky batter", item: "nalysnyky-batter", qty: 3000, batches: 3 },
  { recipe: "Cheese filling", item: "cheese-filling", qty: 2400, batches: 2 },
  { recipe: "Sour cherry compote", item: "cherry-compote", qty: 1500, batches: 1 },
  { recipe: "Dill schmear", item: "herb-schmear", qty: 800, batches: 1 },
  { recipe: "Pickled beets", item: "pickled-beets", qty: 1200, batches: 1 },
];

export const shortfalls: ShoppingLine[] = [
  { item: "farmers-cheese", need: 6000, have: 2500, buy: 3500, buyUnit: "lb", buyQty: 8 },
  { item: "eggs", need: 96, have: 60, buy: 36, buyUnit: "flat", buyQty: 2 },
  { item: "sour-cream", need: 1800, have: 400, buy: 1400, buyUnit: "tub", buyQty: 2 },
];

export const preorders: Preorder[] = [
  { id: "p1", name: "Anya", window: "11:00", items: [{ item: "Syrniki", qty: 4 }] },
  { id: "p2", name: "Marcus", window: "11:00", items: [{ item: "Syrniki", qty: 2 }, { item: "Nalysnyky", qty: 2 }] },
  { id: "p3", name: "Dasha", window: "11:30", items: [{ item: "Nalysnyky", qty: 3 }] },
  { id: "p4", name: "Joel", window: "12:00", items: [{ item: "Syrniki", qty: 6 }] },
  { id: "p5", name: "Ines", window: "12:00", items: [{ item: "Syrniki", qty: 2 }, { item: "Nalysnyky", qty: 4 }] },
  { id: "p6", name: "Tomas", window: "12:30", items: [{ item: "Nalysnyky", qty: 5 }] },
];

export const locations = ["Walk-in", "Dry store", "Freezer"] as const;
export type Location = (typeof locations)[number];

export const countItems: Record<Location, CountItem[]> = {
  "Walk-in": [
    { id: "sour-cream", name: "Sour cream", unit: "tub", step: 1, last: 1, shelf: "Top shelf" },
    { id: "heavy-cream", name: "Heavy cream", unit: "qt", step: 1, last: 3, shelf: "Top shelf" },
    { id: "farmers-cheese", name: "Farmer's cheese", unit: "lb", step: 1, last: 5, shelf: "Top shelf" },
    { id: "butter", name: "Butter", unit: "lb", step: 1, last: 10, shelf: "Middle shelf" },
    { id: "milk", name: "Whole milk", unit: "gal", step: 1, last: 2, shelf: "Middle shelf" },
    { id: "eggs", name: "Eggs", unit: "each", step: 6, last: 60, shelf: "Middle shelf" },
    { id: "dill", name: "Dill", unit: "bunch", step: 1, last: 4, shelf: "Bottom shelf" },
    { id: "parsley", name: "Parsley", unit: "bunch", step: 1, last: 2, shelf: "Bottom shelf" },
    { id: "pickled-beets", name: "Pickled beets", unit: "qt", step: 1, last: 1, shelf: "Bottom shelf" },
    { id: "cherries", name: "Sour cherries", unit: "qt", step: 1, last: 2, shelf: "Bottom shelf" },
  ],
  "Dry store": [
    { id: "flour", name: "Flour", unit: "lb", step: 5, last: 35, shelf: "Shelf 1" },
    { id: "sugar", name: "Sugar", unit: "lb", step: 5, last: 20, shelf: "Shelf 1" },
    { id: "semolina", name: "Semolina", unit: "lb", step: 1, last: 4, shelf: "Shelf 2" },
    { id: "oil", name: "Sunflower oil", unit: "L", step: 1, last: 6, shelf: "Shelf 2" },
  ],
  Freezer: [
    { id: "cherries-frozen", name: "Sour cherries, frozen", unit: "lb", step: 1, last: 8, shelf: "Drawer 1" },
    { id: "crepes", name: "Nalysnyky, spare", unit: "each", step: 6, last: 24, shelf: "Drawer 2" },
  ],
};
