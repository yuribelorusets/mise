import type { PlanResult, ProductionPlan } from "../api/types";
import { prepTasks, shortfalls } from "./ruki";

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

/** What GET /api/kitchen/plans/:id/result answers for each plan: prep to do and what's short. */
export const planResults: Record<string, PlanResult> = {
  "plan-12-05": { prep: prepTasks, shopping: shortfalls, uses: {} },
  "plan-12-06": {
    prep: [
      { recipe: "syrniki-batter", recipeName: "Syrniki batter", item: "syrniki-batter", qty: 3600, batches: 2 },
      { recipe: "nalysnyky-batter", recipeName: "Nalysnyky batter", item: "nalysnyky-batter", qty: 2000, batches: 2 },
      { recipe: "cheese-filling", recipeName: "Cheese filling", item: "cheese-filling", qty: 2400, batches: 2 },
    ],
    shopping: [{ item: "farmers-cheese", name: "Farmer's cheese", need: 5000, have: 0, buy: 5000, buyUnit: "lb", buyQty: 11 }],
    uses: {},
  },
  "plan-12-12": {
    prep: [{ recipe: "syrniki-batter", recipeName: "Syrniki batter", item: "syrniki-batter", qty: 240, batches: 1 }],
    shopping: [],
    uses: {},
  },
};
