import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { factor, toBase } from "./units.js";
import type { Catalog, ConfirmResult, KitchenStore, Proposal, ProposalLine, ProposalView, StockEvent, StockSource } from "./types.js";

export class ProposalError extends Error {
  constructor(message: string, readonly status = 422, readonly problems: (string | null)[] = []) {
    super(message);
  }
}

const KINDS = ["receive", "use", "waste", "count", "move"];
export const MAX_LINES = 50;
const KEEP_DAYS = 30;
const STATUSES = ["open", "confirmed", "discarded"];

/** Why a line can't be booked against this catalog, or null when it can. The same check runs on create, refresh and confirm. */
export function checkLine(c: Catalog, l: ProposalLine): string | null {
  if (typeof l !== "object" || l === null) return "That line is empty.";
  const item = c.items.find((i) => i.id === l.item);
  if (!item) return `"${String(l.item)}" isn't an item yet.`;
  if (!KINDS.includes(l.kind)) return `"${String(l.kind)}" isn't a kind of stock change.`;
  if (!c.locations.some((x) => x.id === l.location)) return `"${String(l.location)}" isn't a storage location.`;
  if (l.kind === "move" && (l.to === l.location || !c.locations.some((x) => x.id === l.to))) return `Moving ${item.name} needs a different location to go to.`;
  if (l.kind !== "move" && l.to !== undefined) return `Only a move has a location to go to.`;
  if (l.unitCost !== undefined && !(typeof l.unitCost === "number" && Number.isFinite(l.unitCost) && l.unitCost >= 0)) return `${String(l.unitCost)} isn't a price.`;
  if (typeof l.unit !== "string" || typeof l.qty !== "number") return `${item.name} needs an amount and a unit.`;
  try {
    toBase(item, l.qty, l.unit);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

/** Keeps only the fields a line has, so a model can't smuggle extra ones into the record. */
export const cleanLine = (l: ProposalLine): ProposalLine => ({
  kind: l.kind, item: l.item, location: l.location, qty: l.qty, unit: l.unit,
  ...(l.to !== undefined ? { to: l.to } : {}),
  ...(l.unitCost !== undefined ? { unitCost: l.unitCost } : {}),
  ...(typeof l.raw === "string" && l.raw.trim() ? { raw: l.raw.trim().slice(0, 200) } : {}),
});

export interface ProposalBookOptions {
  /** Where to keep proposals between restarts. Without it they live in memory. */
  file?: string;
  now?: () => Date;
}

export class ProposalBook {
  protected all = new Map<string, Proposal>();
  protected now: () => Date;

  constructor(protected store: KitchenStore, protected opts: ProposalBookOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    if (opts.file && existsSync(opts.file)) this.load(opts.file);
  }

  create(input: { source: StockSource; lines: ProposalLine[] }): ProposalView {
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > MAX_LINES)
      throw new ProposalError(`A proposal needs between 1 and ${MAX_LINES} lines.`);
    const c = this.store.catalog();
    const problems = input.lines.map((l) => checkLine(c, l));
    if (problems.some(Boolean)) throw new ProposalError(problems.filter(Boolean).join(" "), 422, problems);
    const p: Proposal = {
      id: `p-${randomUUID().slice(0, 8)}`,
      createdAt: this.now().toISOString(),
      source: input.source,
      lines: input.lines.map(cleanLine),
      status: "open",
      basedOn: this.store.events().length,
    };
    this.all.set(p.id, p);
    this.save();
    return this.view(p);
  }

  get(id: string): ProposalView | undefined {
    const p = this.all.get(id);
    return p && this.view(p);
  }

  list(status?: Proposal["status"]): ProposalView[] {
    return [...this.all.values()].filter((p) => !status || p.status === status).map((p) => this.view(p));
  }

  confirm(id: string, edits?: ProposalLine[]): ConfirmResult {
    const p = this.need(id);
    if (p.status === "confirmed") return { proposal: this.view(p), events: [...(p.events ?? [])] };
    if (p.status === "discarded") throw new ProposalError("This proposal was discarded.", 409);
    // A confirm that wrote its events and then died: finish it with what was booked, whatever the retry says.
    const booked = this.store.events().filter((e) => e.proposal === p.id && e.id.startsWith(`${p.id}-`));
    if (booked.length) {
      Object.assign(p, { status: "confirmed", confirmedAt: booked[0].at, events: booked.map((e) => e.id) });
      this.save();
      return { proposal: this.view(p), events: [...p.events!] };
    }
    const lines = edits ?? p.lines;
    if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) throw new ProposalError(`A proposal needs between 1 and ${MAX_LINES} lines.`);
    if (this.isStale(p, lines)) throw new ProposalError("Stock changed since this was made. Refresh it first.", 409);
    const c = this.store.catalog();
    const problems = lines.map((l) => checkLine(c, l));
    if (problems.some(Boolean)) throw new ProposalError(problems.filter(Boolean).join(" "), 422, problems);
    const at = this.now().toISOString();
    const events: StockEvent[] = lines.map((l, i) => {
      const item = c.items.find((x) => x.id === l.item)!;
      return {
        id: `${p.id}-${i}`, at, kind: l.kind, item: l.item, location: l.location,
        qty: toBase(item, l.qty, l.unit),
        ...(l.kind === "move" ? { to: l.to } : {}),
        source: p.source,
        ...(l.unitCost !== undefined ? { unitCost: l.unitCost / factor(item, l.unit) } : {}),
        ...(l.raw ? { note: l.raw } : {}),
        proposal: p.id,
      };
    });
    this.store.append(events);
    Object.assign(p, { lines: lines.map(cleanLine), status: "confirmed", confirmedAt: at, events: events.map((e) => e.id) });
    this.save();
    return { proposal: this.view(p), events: [...p.events!] };
  }

  discard(id: string): ProposalView {
    const p = this.need(id);
    if (p.status === "confirmed") throw new ProposalError("This proposal is already booked.", 409);
    if (p.status === "open") Object.assign(p, { status: "discarded", discardedAt: this.now().toISOString() });
    this.save();
    return this.view(p);
  }

  refresh(id: string): ProposalView {
    const p = this.need(id);
    if (p.status !== "open") throw new ProposalError("Only an open proposal can be refreshed.", 409);
    p.basedOn = this.store.events().length;
    this.save();
    return this.view(p);
  }

  protected need(id: unknown): Proposal {
    const p = typeof id === "string" ? this.all.get(id) : undefined;
    if (!p) throw new ProposalError("There's no proposal with that id.", 404);
    return p;
  }

  /** Stale: an event after `basedOn`, not written by this proposal, is for one of its items. */
  protected isStale(p: Proposal, also: ProposalLine[] = []): boolean {
    const events = this.store.events();
    if (p.status !== "open" || p.basedOn >= events.length) return false;
    const items = new Set([...p.lines, ...also].map((l) => l.item));
    for (let i = p.basedOn; i < events.length; i++) if (events[i].proposal !== p.id && items.has(events[i].item)) return true;
    return false;
  }

  protected view(p: Proposal): ProposalView {
    const c = p.status === "open" ? this.store.catalog() : undefined;
    return { ...structuredClone(p), stale: this.isStale(p), problems: p.lines.map((l) => (c ? checkLine(c, l) : null)) };
  }

  /** Writes through a .tmp file and a rename, so a crash can't leave half a file. Old confirmed and discarded proposals are dropped. */
  protected save() {
    const file = this.opts.file;
    if (!file) return;
    const cutoff = this.now().getTime() - KEEP_DAYS * 24 * 60 * 60_000;
    for (const [id, p] of this.all) {
      const done = p.confirmedAt ?? p.discardedAt;
      if (p.status !== "open" && done && Date.parse(done) < cutoff) this.all.delete(id);
    }
    writeFileSync(`${file}.tmp`, JSON.stringify([...this.all.values()]));
    renameSync(`${file}.tmp`, file);
  }

  protected load(file: string) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      throw new Error(`Invalid proposals file ${file}: ${(e as Error).message}`);
    }
    if (!Array.isArray(data)) throw new Error(`Invalid proposals file ${file}: expected a list.`);
    let skipped = 0;
    for (const r of data) {
      if (typeof r?.id === "string" && STATUSES.includes(r.status) && typeof r.basedOn === "number" && Array.isArray(r.lines)) this.all.set(r.id, r);
      else skipped++;
    }
    if (skipped) console.warn(`Skipped ${skipped} unreadable record(s) in ${file}.`);
  }
}
