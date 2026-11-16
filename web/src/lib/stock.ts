import type { Item, StockEvent, StockView } from "../api/types";
import { daysBetween } from "./format";

export type Flag = "negative" | "expired" | "near-expiry" | "below-par";

export interface StockRow {
  item: string;
  location: string;
  /** On hand in base units. Can be negative. */
  qty: number;
  /** When this item was last received, anywhere. */
  arrivedAt?: string;
  /** Days until the shelf life runs out, counted from the last receive. Negative once past it. */
  daysLeft?: number;
  flags: Flag[];
}

const NEAR_EXPIRY_DAYS = 2;

/** One row per item and location from the server's on-hand figures, flagged against shelf life and par. */
export function stockRows(view: StockView, items: readonly Item[], now: string): StockRow[] {
  const rows: StockRow[] = [];
  for (const [id, byLocation] of Object.entries(view.onHand)) {
    const item = items.find((i) => i.id === id);
    const total = Object.values(byLocation).reduce((a, b) => a + b, 0);
    const arrivedAt = view.lastReceived[id];
    for (const [location, qty] of Object.entries(byLocation)) {
      const row: StockRow = { item: id, location, qty, flags: [] };
      if (item?.shelfLifeDays !== undefined && arrivedAt && qty > 0) {
        row.arrivedAt = arrivedAt;
        row.daysLeft = item.shelfLifeDays - daysBetween(arrivedAt, now);
      } else if (arrivedAt) row.arrivedAt = arrivedAt;
      if (qty < 0) row.flags.push("negative");
      if (row.daysLeft !== undefined && row.daysLeft < 0) row.flags.push("expired");
      else if (row.daysLeft !== undefined && row.daysLeft <= NEAR_EXPIRY_DAYS) row.flags.push("near-expiry");
      if (total >= 0 && item?.par !== undefined && total < item.par) row.flags.push("below-par");
      rows.push(row);
    }
  }
  return rows;
}

/** How an event changed the amount at one location: "+", "−" or "=" for a count. */
export function eventSign(e: StockEvent, location: string): "+" | "−" | "=" {
  if (e.kind === "count") return "=";
  if (e.kind === "receive") return "+";
  if (e.kind === "move" && e.to === location) return "+";
  return "−";
}
