import type { StockEvent } from "./types.js";

/** item -> location -> amount in base units */
export type OnHand = Record<string, Record<string, number>>;

export function onHand(events: readonly StockEvent[]): OnHand {
  const oh: OnHand = {};
  const at = (item: string) => (oh[item] ??= {});
  for (const e of events) {
    const locs = at(e.item);
    const cur = locs[e.location] ?? 0;
    if (e.kind === "receive") locs[e.location] = cur + e.qty;
    else if (e.kind === "use" || e.kind === "waste") locs[e.location] = cur - e.qty;
    else if (e.kind === "count") locs[e.location] = e.qty;
    else if (e.kind === "move" && e.to) {
      locs[e.location] = cur - e.qty;
      locs[e.to] = (locs[e.to] ?? 0) + e.qty;
    }
  }
  return oh;
}

export const total = (oh: OnHand, item: string) => Object.values(oh[item] ?? {}).reduce((a, b) => a + b, 0);

export const totals = (oh: OnHand): Record<string, number> => Object.fromEntries(Object.keys(oh).map((id) => [id, total(oh, id)]));

export function latestUnitCost(events: readonly StockEvent[], item: string): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.item === item && e.kind === "receive" && e.unitCost !== undefined) return e.unitCost;
  }
  return undefined;
}
