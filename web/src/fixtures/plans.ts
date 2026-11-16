import type { PrepTask, ShoppingLine } from "../api/types";
import { prepTasks, shortfalls } from "./ruki";
import type { ProductionPlan } from "./types";

// Saturday's preorder lines add up to the six preorders on Today.
export const plans: ProductionPlan[] = [
  {
    id: "plan-12-05",
    date: "2026-12-05",
    lines: [
      { item: "syrniki", qty: 26, unit: "order", source: "manual" },
      { item: "syrniki", qty: 14, unit: "order", source: "preorder" },
      { item: "nalysnyky", qty: 16, unit: "order", source: "manual" },
      { item: "nalysnyky", qty: 14, unit: "order", source: "preorder" },
    ],
  },
  {
    id: "plan-12-06",
    date: "2026-12-06",
    lines: [
      { item: "syrniki", qty: 30, unit: "order", source: "manual" },
      { item: "nalysnyky", qty: 20, unit: "order", source: "manual" },
    ],
  },
  {
    id: "plan-12-12",
    date: "2026-12-12",
    lines: [{ item: "syrniki", qty: 2, unit: "order", source: "preorder" }],
  },
];

export interface PlanSummary {
  prep: PrepTask[];
  shortfalls: ShoppingLine[];
}

/** What the kitchen core would work out for each plan: prep to do and what's short. */
export const planSummaries: Record<string, PlanSummary> = {
  "plan-12-05": { prep: prepTasks, shortfalls },
  "plan-12-06": {
    prep: [
      { recipe: "Syrniki batter", item: "syrniki-batter", qty: 3600, batches: 2 },
      { recipe: "Nalysnyky batter", item: "nalysnyky-batter", qty: 2000, batches: 2 },
      { recipe: "Cheese filling", item: "cheese-filling", qty: 2400, batches: 2 },
    ],
    shortfalls: [{ item: "farmers-cheese", need: 5000, have: 0, buy: 5000, buyUnit: "lb", buyQty: 11 }],
  },
  "plan-12-12": {
    prep: [{ recipe: "Syrniki batter", item: "syrniki-batter", qty: 240, batches: 1 }],
    shortfalls: [],
  },
};
