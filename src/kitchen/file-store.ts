import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateCatalog } from "./catalog.js";
import type { Catalog, KitchenStore, StockEvent } from "./types.js";

const KINDS = ["receive", "use", "waste", "count", "move"];
const nonEmpty = (v: unknown) => typeof v === "string" && v.length > 0;

export function isStockEvent(v: unknown): v is StockEvent {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  return nonEmpty(e.id) && nonEmpty(e.at) && nonEmpty(e.item) && nonEmpty(e.location) && nonEmpty(e.source)
    && typeof e.kind === "string" && KINDS.includes(e.kind)
    && typeof e.qty === "number" && Number.isFinite(e.qty) && e.qty >= 0
    && (e.to === undefined || nonEmpty(e.to))
    && (e.unitCost === undefined || (typeof e.unitCost === "number" && Number.isFinite(e.unitCost) && e.unitCost >= 0));
}

function check(c: Catalog, where: string) {
  const errors = validateCatalog(c);
  if (errors.length) throw new Error(`Invalid ${where}: ${errors.join(" ")}`);
}

export class FileStore implements KitchenStore {
  private cat: Catalog;
  private log: StockEvent[] = [];
  private catalogFile: string;
  private eventsFile: string;
  /** True when the events file ends mid-line, so the next append must start a new one. */
  private torn = false;

  constructor(dir: string, kitchen: string, seed: Catalog) {
    mkdirSync(dir, { recursive: true });
    this.catalogFile = join(dir, `${kitchen}.catalog.json`);
    this.eventsFile = join(dir, `${kitchen}.stock.jsonl`);
    this.cat = existsSync(this.catalogFile) ? this.readCatalog() : structuredClone(seed);
    check(this.cat, existsSync(this.catalogFile) ? this.catalogFile : "the seed catalog");
    if (existsSync(this.eventsFile)) {
      const text = readFileSync(this.eventsFile, "utf8");
      this.torn = text.length > 0 && !text.endsWith("\n");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e: unknown = JSON.parse(line);
          if (isStockEvent(e)) this.log.push(e);
          else console.warn(`[mise] skipped a line that isn't a stock event in ${this.eventsFile}`);
        } catch { console.warn(`[mise] skipped a corrupt line in ${this.eventsFile}`); }
      }
    }
  }

  private readCatalog(): Catalog {
    try { return JSON.parse(readFileSync(this.catalogFile, "utf8")); }
    catch (e) { throw new Error(`Can't read ${this.catalogFile}: ${(e as Error).message}`); }
  }

  catalog(): Catalog { return structuredClone(this.cat); }

  saveCatalog(c: Catalog) {
    check(c, "the catalog");
    const tmp = `${this.catalogFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(c, null, 2));
    renameSync(tmp, this.catalogFile);
    this.cat = structuredClone(c);
  }

  events(): readonly StockEvent[] { return this.log; }

  append(events: StockEvent[]) {
    for (const e of events) if (!isStockEvent(e)) throw new Error(`Not a valid stock event: ${JSON.stringify(e)}`);
    const seen = new Set(this.log.map((e) => e.id));
    events = events.filter((e) => !seen.has(e.id) && (seen.add(e.id), true));
    if (!events.length) return;
    appendFileSync(this.eventsFile, (this.torn ? "\n" : "") + events.map((e) => JSON.stringify(e)).join("\n") + "\n");
    this.torn = false;
    this.log.push(...events);
  }
}
