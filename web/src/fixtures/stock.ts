import type { StockEvent } from "./types";

type Row = [at: string, kind: StockEvent["kind"], item: string, location: string, qty: number, source: StockEvent["source"], extra?: Partial<StockEvent>];

// Oldest first, amounts in base units. Jam goes negative on purpose: the
// case that arrived on 1 December was never logged.
const rows: Row[] = [
  ["2026-11-05T09:10:00", "receive", "cherries-frozen", "freezer", 3632, "manual"],
  ["2026-11-10T08:40:00", "receive", "flour", "dry-store", 22680, "receipt", { unitCost: 0.0015, note: "2 bags" }],
  ["2026-11-10T08:40:00", "receive", "sugar", "dry-store", 9080, "receipt", { unitCost: 0.002 }],
  ["2026-11-10T08:40:00", "receive", "oil", "dry-store", 5000, "receipt", { unitCost: 0.004 }],
  ["2026-11-12T08:30:00", "receive", "jam", "dry-store", 1020, "receipt", { unitCost: 0.012, note: "3 jars" }],
  ["2026-11-20T08:20:00", "receive", "butter", "walk-in", 4540, "receipt", { unitCost: 0.011 }],
  ["2026-11-24T08:15:00", "receive", "eggs", "walk-in", 180, "receipt", { unitCost: 0.35, note: "1 case" }],
  ["2026-11-25T08:20:00", "receive", "sour-cream", "walk-in", 1800, "receipt", { unitCost: 0.0066, note: "2 tubs" }],
  ["2026-11-26T08:20:00", "receive", "milk", "walk-in", 3785, "receipt", { unitCost: 0.0012 }],
  ["2026-11-28T06:50:00", "use", "eggs", "walk-in", 96, "production"],
  ["2026-11-28T06:50:00", "use", "sour-cream", "walk-in", 1200, "production"],
  ["2026-11-28T06:50:00", "use", "milk", "walk-in", 1000, "production"],
  ["2026-11-28T06:50:00", "use", "butter", "walk-in", 500, "production"],
  ["2026-11-28T06:50:00", "use", "flour", "dry-store", 4000, "production"],
  ["2026-11-28T06:50:00", "use", "sugar", "dry-store", 800, "production"],
  ["2026-11-28T06:50:00", "use", "oil", "dry-store", 600, "production"],
  ["2026-11-28T06:50:00", "use", "jam", "dry-store", 600, "production"],
  ["2026-11-29T13:30:00", "waste", "sour-cream", "walk-in", 200, "chat", { note: "left out during service" }],
  ["2026-12-01T08:30:00", "receive", "farmers-cheese", "walk-in", 5000, "receipt", { unitCost: 0.0132 }],
  ["2026-12-02T16:00:00", "count", "eggs", "walk-in", 60, "manual"],
  ["2026-12-03T15:00:00", "use", "farmers-cheese", "walk-in", 2500, "production"],
  ["2026-12-03T15:00:00", "use", "flour", "dry-store", 500, "production"],
  ["2026-12-03T15:00:00", "receive", "syrniki-batter", "walk-in", 2400, "production", { note: "test batch" }],
  ["2026-12-03T17:30:00", "use", "syrniki-batter", "walk-in", 1800, "production"],
  ["2026-12-03T17:30:00", "use", "jam", "dry-store", 620, "production"],
  ["2026-12-03T17:30:00", "receive", "syrniki", "walk-in", 24, "production", { note: "test batch" }],
  ["2026-12-03T18:00:00", "move", "syrniki", "walk-in", 12, "chat", { to: "freezer" }],
];

export const stockEvents: StockEvent[] = rows.map(([at, kind, item, location, qty, source, extra], i) => ({
  id: `e${i + 1}`,
  at,
  kind,
  item,
  location,
  qty,
  source,
  ...extra,
}));
