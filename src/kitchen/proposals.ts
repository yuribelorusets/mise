import { randomUUID } from "node:crypto";
import { toBase } from "./units.js";
import type { Catalog, KitchenStore, Proposal, ProposalLine, ProposalView, StockSource } from "./types.js";

export class ProposalError extends Error {
  constructor(message: string, readonly status = 422, readonly problems: (string | null)[] = []) {
    super(message);
  }
}

const KINDS = ["receive", "use", "waste", "count", "move"];
export const MAX_LINES = 50;

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
    return this.view(p);
  }

  get(id: string): ProposalView | undefined {
    const p = this.all.get(id);
    return p && this.view(p);
  }

  list(status?: Proposal["status"]): ProposalView[] {
    return [...this.all.values()].filter((p) => !status || p.status === status).map((p) => this.view(p));
  }

  protected view(p: Proposal): ProposalView {
    return { ...structuredClone(p), stale: false, problems: p.lines.map(() => null) };
  }
}
