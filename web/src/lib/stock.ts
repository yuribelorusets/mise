import type { Item, StockEvent } from "../fixtures/types";
import { daysBetween } from "./format";

export type Flag = "negative" | "expired" | "near-expiry" | "below-par";

export interface StockRow {
  item: string;
  location: string;
  /** On hand in base units. Can be negative. */
  qty: number;
  /** When the stock last arrived here: a receive, or a move in. */
  arrivedAt?: string;
  arrivedBy?: "received" | "moved in";
  /** Days until expiry, when the item has a shelf life. Negative once expired. */
  daysLeft?: number;
  flags: Flag[];
  /** Events that touched this item at this location, newest first. */
  history: StockEvent[];
}

const NEAR_EXPIRY_DAYS = 2;

/** Fold the event log into on-hand rows, one per item and location, in first-seen order. */
export function onHand(events: readonly StockEvent[], items: readonly Item[], now: string): StockRow[] {
  const rows = new Map<string, StockRow>();
  const row = (item: string, location: string) => {
    const key = `${location}/${item}`;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { item, location, qty: 0, flags: [], history: [] }));
    return r;
  };

  for (const e of events) {
    const r = row(e.item, e.location);
    r.history.unshift(e);
    if (e.kind === "receive") {
      r.qty += e.qty;
      r.arrivedAt = e.at;
      r.arrivedBy = "received";
    } else if (e.kind === "count") {
      r.qty = e.qty;
    } else {
      r.qty -= e.qty;
    }
    if (e.kind === "move" && e.to) {
      const dest = row(e.item, e.to);
      dest.history.unshift(e);
      dest.qty += e.qty;
      dest.arrivedAt = e.at;
      dest.arrivedBy = "moved in";
    }
  }

  for (const r of rows.values()) {
    const item = items.find((i) => i.id === r.item);
    if (item?.shelfLifeDays !== undefined && r.arrivedAt && r.qty > 0) {
      r.daysLeft = item.shelfLifeDays - daysBetween(r.arrivedAt, now);
    }
    if (r.qty < 0) r.flags.push("negative");
    if (r.daysLeft !== undefined && r.daysLeft < 0) r.flags.push("expired");
    else if (r.daysLeft !== undefined && r.daysLeft <= NEAR_EXPIRY_DAYS) r.flags.push("near-expiry");
    if (r.qty >= 0 && item?.par !== undefined && r.qty < item.par) r.flags.push("below-par");
  }
  return [...rows.values()];
}

/** How an event changed the amount at one location: "+", "-" or "=" for a count. */
export function eventSign(e: StockEvent, location: string): "+" | "−" | "=" {
  if (e.kind === "count") return "=";
  if (e.kind === "receive") return "+";
  if (e.kind === "move" && e.to === location) return "+";
  return "−";
}
