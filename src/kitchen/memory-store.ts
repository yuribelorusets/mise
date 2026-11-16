import type { Catalog, KitchenStore, StockEvent } from "./types.js";

/** Keeps everything in memory. For tests, and for running without a data directory. */
export class MemoryStore implements KitchenStore {
  private cat: Catalog;
  private log: StockEvent[] = [];
  constructor(catalog: Catalog) { this.cat = structuredClone(catalog); }
  catalog(): Catalog { return structuredClone(this.cat); }
  saveCatalog(c: Catalog) { this.cat = structuredClone(c); }
  events(): readonly StockEvent[] { return this.log; }
  /** Skips ids it already has, as `FileStore.append` does, so a repeated confirm can't write twice. */
  append(events: StockEvent[]) {
    const seen = new Set(this.log.map((e) => e.id));
    for (const e of events) if (!seen.has(e.id)) { seen.add(e.id); this.log.push({ ...e }); }
  }
}
