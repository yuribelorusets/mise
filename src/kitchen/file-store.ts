import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, KitchenStore, StockEvent } from "./types.js";

export class FileStore implements KitchenStore {
  private cat: Catalog;
  private log: StockEvent[] = [];
  private catalogFile: string;
  private eventsFile: string;

  constructor(dir: string, kitchen: string, seed: Catalog) {
    mkdirSync(dir, { recursive: true });
    this.catalogFile = join(dir, `${kitchen}.catalog.json`);
    this.eventsFile = join(dir, `${kitchen}.stock.jsonl`);
    this.cat = existsSync(this.catalogFile) ? JSON.parse(readFileSync(this.catalogFile, "utf8")) : structuredClone(seed);
    if (existsSync(this.eventsFile))
      for (const line of readFileSync(this.eventsFile, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { this.log.push(JSON.parse(line)); } catch { console.warn(`[mise] skipped a corrupt line in ${this.eventsFile}`); }
      }
  }

  catalog(): Catalog { return structuredClone(this.cat); }

  saveCatalog(c: Catalog) {
    const tmp = `${this.catalogFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(c, null, 2));
    renameSync(tmp, this.catalogFile);
    this.cat = structuredClone(c);
  }

  events(): readonly StockEvent[] { return this.log; }

  append(events: StockEvent[]) {
    appendFileSync(this.eventsFile, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    this.log.push(...events);
  }
}
