import type { Catalog, KitchenStore, StockEvent } from "./types.js";

/** Keeps everything in memory. For tests, and for running without a data directory. */
export class MemoryStore implements KitchenStore {
  private cat: Catalog;
  private log: StockEvent[] = [];
  constructor(catalog: Catalog) { this.cat = structuredClone(catalog); }
  catalog(): Catalog { return structuredClone(this.cat); }
  saveCatalog(c: Catalog) { this.cat = structuredClone(c); }
  events(): readonly StockEvent[] { return this.log; }
  append(events: StockEvent[]) { this.log.push(...events.map((e) => ({ ...e }))); }
}
