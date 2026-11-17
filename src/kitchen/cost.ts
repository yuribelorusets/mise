import type { Catalog, StockEvent } from "./types.js";
import { explode } from "./plan.js";
import { latestUnitCost } from "./stock.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What it costs to make this much from scratch, ignoring what's on hand. */
export function batchCost(c: Catalog, events: readonly StockEvent[], item: string, qty: number, unit: string) {
  const { shopping } = explode(c, [{ item, qty, unit, source: "manual" }], {});
  let cost = 0;
  const missing: string[] = [];
  for (const s of shopping) {
    const price = latestUnitCost(events, s.item);
    if (price === undefined) missing.push(s.item);
    else cost += price * s.need;
  }
  return { cost: round2(cost), missing };
}

/** The most whole `unit`s of an item you can make from what's available, or Infinity when stock allows at least `limit`. */
export function maxBatch(c: Catalog, available: Record<string, number>, item: string, unit: string, limit = 10_000): number {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError(`The search limit must be a positive whole number, not ${limit}.`);
  const fits = (n: number) => explode(c, [{ item, qty: n, unit, source: "manual" }], available).shopping.length === 0;
  if (fits(limit)) return Infinity;
  let lo = 0, hi = limit - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}
