import { readFileSync } from "node:fs";
import { MemoryStore } from "../../../src/kitchen/memory-store.js";
import { ProposalBook } from "../../../src/kitchen/proposals.js";
import type { KitchenToolContext } from "../../../src/kitchen/assistant/tools.js";
import type { Catalog, StockEvent } from "../../../src/kitchen/types.js";

export const ruki: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));
export const saturday = { id: "sat", date: "2026-12-05", lines: [{ item: "syrniki", qty: 40, unit: "order", source: "manual" as const }] };

export const ev = (item: string, qty: number, location = "walk-in", over: Partial<StockEvent> = {}): StockEvent =>
  ({ id: `e-${item}-${qty}`, at: "2026-12-04T09:00:00Z", kind: "count", item, location, qty, source: "manual", ...over });

export function ctx(events: StockEvent[] = [], catalog: Catalog = { ...ruki, plans: [saturday] }): KitchenToolContext {
  const store = new MemoryStore(catalog);
  store.append(events);
  return { store, proposals: new ProposalBook(store), today: "2026-12-04", offers: [], proposed: [] };
}
