// What the kitchen API answers for Saturday's pop-up, as test data for the fake API. Shapes are the
// API's (TodayView, Catalog, StockView); amounts are in base units (g, ml, each).
import type { BaseUnit, Catalog, GuestPreorder, Item, PlanResult, StockView, TodayView } from "../api/types";

const item = (id: string, name: string, baseUnit: BaseUnit, units: Item["units"] = {}): Item => ({ id, name, aliases: [], baseUnit, units, allergens: [] });

export const items: Item[] = [
  item("syrniki", "Syrniki", "each", { order: 3 }),
  item("nalysnyky", "Nalysnyky", "each", { order: 2 }),
  item("syrniki-batter", "Syrniki batter", "g"),
  item("nalysnyky-batter", "Nalysnyky batter", "ml"),
  item("cheese-filling", "Cheese filling", "g"),
  item("cherry-compote", "Sour cherry compote", "ml"),
  item("herb-schmear", "Dill schmear", "g"),
  item("pickled-beets", "Pickled beets", "g"),
  item("farmers-cheese", "Farmer's cheese", "g", { lb: 453.59237 }),
  item("eggs", "Eggs", "each", { flat: 30, dozen: 12 }),
  item("sour-cream", "Sour cream", "g", { tub: 907 }),
  item("flour", "Flour", "g"),
  item("sugar", "Sugar", "g"),
];

export const catalog: Catalog = {
  items,
  locations: [
    { id: "walk-in", name: "Walk-in", shelfOrder: ["sour-cream", "farmers-cheese", "eggs"] },
    { id: "dry", name: "Dry store", shelfOrder: ["flour", "sugar"] },
  ],
  recipes: [],
  plans: [],
};

export const pickupDate = "2026-12-05";

export const prepTasks: TodayView["prep"] = [
  { recipe: "syrniki-batter", recipeName: "Syrniki batter", item: "syrniki-batter", qty: 4800, batches: 2 },
  { recipe: "nalysnyky-batter", recipeName: "Nalysnyky batter", item: "nalysnyky-batter", qty: 3000, batches: 3 },
  { recipe: "cheese-filling", recipeName: "Cheese filling", item: "cheese-filling", qty: 2400, batches: 2 },
  { recipe: "cherry-compote", recipeName: "Sour cherry compote", item: "cherry-compote", qty: 1500, batches: 1 },
  { recipe: "dill-schmear", recipeName: "Dill schmear", item: "herb-schmear", qty: 800, batches: 1 },
  { recipe: "pickled-beets", recipeName: "Pickled beets", item: "pickled-beets", qty: 1200, batches: 1 },
];

export const shortfalls: TodayView["shopping"] = [
  { item: "farmers-cheese", name: "Farmer's cheese", need: 6000, have: 2500, buy: 3500, buyUnit: "lb", buyQty: 8 },
  { item: "eggs", name: "Eggs", need: 96, have: 60, buy: 36, buyUnit: "flat", buyQty: 2 },
  { item: "sour-cream", name: "Sour cream", need: 1800, have: 400, buy: 1400, buyUnit: "tub", buyQty: 2 },
];

export const preorders: GuestPreorder[] = [
  { firstName: "Anya", pickupTime: "11:00", items: [{ name: "Syrniki", quantity: 4 }] },
  { firstName: "Marcus", pickupTime: "11:00", items: [{ name: "Syrniki", quantity: 2 }, { name: "Nalysnyky", quantity: 2 }] },
  { firstName: "Dasha", pickupTime: "11:30", items: [{ name: "Nalysnyky", quantity: 3 }] },
  { firstName: "Joel", pickupTime: "12:00", items: [{ name: "Syrniki", quantity: 6 }] },
  { firstName: "Ines", pickupTime: "12:00", items: [{ name: "Syrniki", quantity: 2 }, { name: "Nalysnyky", quantity: 4 }] },
  { firstName: "Tomas", pickupTime: "12:30", items: [{ name: "Nalysnyky", quantity: 5 }] },
];

export const todayView: TodayView = {
  date: pickupDate,
  plan: {
    id: "plan-2026-12-05",
    date: pickupDate,
    lines: [
      { item: "syrniki", qty: 40, unit: "order", source: "manual" },
      { item: "nalysnyky", qty: 30, unit: "order", source: "manual" },
    ],
  },
  prep: prepTasks,
  shopping: shortfalls,
  preorders,
};

export const planResult: PlanResult = { prep: prepTasks, shopping: shortfalls, uses: {} };

export const stockView: StockView = {
  basedOn: 12,
  onHand: {
    "sour-cream": { "walk-in": 907 },
    "farmers-cheese": { "walk-in": 2268 },
    eggs: { "walk-in": 60 },
    flour: { dry: 15876 },
    sugar: { dry: 9072 },
  },
  lastCount: {
    "sour-cream": { "walk-in": { qty: 907, at: "2026-12-03T09:00:00.000Z" } },
    "farmers-cheese": { "walk-in": { qty: 2268, at: "2026-12-03T09:00:00.000Z" } },
    eggs: { "walk-in": { qty: 60, at: "2026-12-03T09:00:00.000Z" } },
    flour: { dry: { qty: 15876, at: "2026-12-03T09:10:00.000Z" } },
  },
  lastReceived: {},
};
