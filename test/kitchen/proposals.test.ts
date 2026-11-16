import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../src/kitchen/memory-store.js";
import { ProposalBook, ProposalError } from "../../src/kitchen/proposals.js";
import { onHand, total } from "../../src/kitchen/stock.js";
import type { Catalog, ProposalLine, StockEvent } from "../../src/kitchen/types.js";

const catalog: Catalog = {
  items: [
    { id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: { case: 180 }, allergens: [] },
    { id: "flour", name: "Flour", aliases: [], baseUnit: "g", units: {}, allergens: [] },
  ],
  locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: [] }, { id: "dry", name: "Dry storage", shelfOrder: [] }],
  recipes: [],
  plans: [],
};
const eggs: ProposalLine = { kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case", unitCost: 54, raw: "two cases eggs" };
const flour: ProposalLine = { kind: "receive", item: "flour", location: "dry", qty: 5, unit: "kg" };
const counted = (item: string, qty: number): StockEvent => ({ id: `m-${item}-${qty}`, at: "2026-12-04T17:00:00Z", kind: "count", item, location: "walk-in", qty, source: "manual" });
const setup = (file?: string, store = new MemoryStore(catalog)) => ({ store, book: new ProposalBook(store, { file, now: () => new Date("2026-12-04T18:00:00Z") }) });
const refused = (fn: () => unknown): ProposalError => {
  try { fn(); } catch (e) { if (e instanceof ProposalError) return e; throw e; }
  throw new Error("expected a ProposalError");
};
const eggCount = (store: MemoryStore) => total(onHand(store.events()), "eggs");
const ev = (id: string): StockEvent => ({ id, at: "2026-12-01T10:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 180, source: "manual" });
const line: ProposalLine = { kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case" };

describe("ProposalBook.create", () => {
  it("refuses a line for an unknown item with a 422 and a problem for that line", () => {
    const book = new ProposalBook(new MemoryStore(catalog));
    let err: unknown;
    try {
      book.create({ source: "chat", lines: [line, { ...line, item: "truffles" }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProposalError);
    expect((err as ProposalError).status).toBe(422);
    expect((err as ProposalError).problems[0]).toBeNull();
    expect((err as ProposalError).problems[1]).toMatch(/truffles/);
    expect(book.list()).toHaveLength(0);
  });

  it("keeps basedOn at the event count", () => {
    const store = new MemoryStore(catalog);
    store.append([ev("e1"), ev("e2")]);
    const p = new ProposalBook(store).create({ source: "chat", lines: [line] });
    expect(p.basedOn).toBe(2);
    expect(p.status).toBe("open");
  });

  it("drops a field that isn't part of a line", () => {
    const book = new ProposalBook(new MemoryStore(catalog));
    const p = book.create({ source: "chat", lines: [{ ...line, evil: 1 } as ProposalLine] });
    expect(p.lines[0]).not.toHaveProperty("evil");
    expect(book.get(p.id)?.lines[0]).toEqual(line);
  });
});

describe("proposal lifecycle", () => {
  it("writes nothing until it's confirmed", () => {
    const { store, book } = setup();
    book.create({ source: "chat", lines: [eggs] });
    expect(store.events()).toHaveLength(0);
  });

  it("books every line in one append, with ids from the proposal", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs, flour] });
    const r = book.confirm(p.id);
    expect(r.events).toEqual([`${p.id}-0`, `${p.id}-1`]);
    expect(eggCount(store)).toBe(360);
    expect(store.events()[0]).toMatchObject({ source: "chat", proposal: p.id, note: "two cases eggs" });
    expect(store.events()[0].unitCost).toBeCloseTo(0.3);
    expect(r.proposal).toMatchObject({ status: "confirmed", confirmedAt: "2026-12-04T18:00:00.000Z", events: r.events });
  });

  it("returns the same result when confirmed twice, and writes once", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    const first = book.confirm(p.id);
    expect(book.confirm(p.id, [{ ...eggs, qty: 9 }])).toEqual(first);
    expect(store.events()).toHaveLength(1);
  });

  it("writes once when two confirms arrive together", async () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    const [a, b] = await Promise.all([1, 2].map(() => Promise.resolve().then(() => book.confirm(p.id))));
    expect(a).toEqual(b);
    expect(store.events()).toHaveLength(1);
  });

  it("books the owner's edits, not the draft", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    book.confirm(p.id, [{ ...eggs, qty: 1 }]);
    expect(eggCount(store)).toBe(180);
    expect(book.get(p.id)?.lines[0].qty).toBe(1);
  });

  it("writes nothing if any line is bad, and says which", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs, flour] });
    for (const bad of [{ ...flour, unit: "qt" }, { ...flour, qty: Number.NaN }, { ...flour, qty: -1 }, { ...flour, qty: Infinity }, { ...flour, location: "attic" }, { ...flour, item: "sumac" }, { ...flour, kind: "move" as const, to: "dry" }]) {
      const e = refused(() => book.confirm(p.id, [eggs, bad]));
      expect(e.status).toBe(422);
      expect(e.problems[0]).toBeNull();
      expect(e.problems[1]).toEqual(expect.any(String));
    }
    expect(store.events()).toHaveLength(0);
    expect(book.get(p.id)?.status).toBe("open");
  });

  it("goes stale when a newer event touches one of its items", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    store.append([counted("eggs", 300)]);
    expect(book.get(p.id)?.stale).toBe(true);
    expect(refused(() => book.confirm(p.id)).status).toBe(409);
    expect(eggCount(store)).toBe(300);
  });

  it("stays fresh when newer events touch other items", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    store.append([counted("flour", 500)]);
    expect(book.get(p.id)?.stale).toBe(false);
    book.confirm(p.id);
    expect(eggCount(store)).toBe(360);
  });

  it("is stale when an edit moves a line onto an item that changed", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [flour] });
    store.append([counted("eggs", 300)]);
    expect(refused(() => book.confirm(p.id, [eggs])).status).toBe(409);
  });

  it("refresh re-checks the same lines and clears stale", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    store.append([counted("eggs", 300)]);
    const r = book.refresh(p.id);
    expect(r).toMatchObject({ id: p.id, stale: false, basedOn: 1, lines: p.lines });
    book.confirm(p.id);
    expect(eggCount(store)).toBe(660);
  });

  it("refresh flags a line the catalog no longer has", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs, flour] });
    store.saveCatalog({ ...catalog, items: catalog.items.filter((i) => i.id !== "flour") });
    const r = book.refresh(p.id);
    expect(r.problems[0]).toBeNull();
    expect(r.problems[1]).toMatch(/flour/);
    expect(refused(() => book.confirm(p.id)).status).toBe(422);
  });

  it("keeps a discarded proposal as a stub that can't be booked", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    const stub = book.discard(p.id);
    expect(stub).toMatchObject({ status: "discarded", discardedAt: "2026-12-04T18:00:00.000Z", lines: p.lines });
    expect(book.discard(p.id)).toEqual(stub);
    expect(book.list().map((x) => x.id)).toContain(p.id);
    expect(refused(() => book.confirm(p.id)).status).toBe(409);
    expect(refused(() => book.refresh(p.id)).status).toBe(409);
    expect(store.events()).toHaveLength(0);
  });

  it("won't discard a confirmed proposal, and doesn't know made-up ids", () => {
    const { book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    book.confirm(p.id);
    expect(refused(() => book.discard(p.id)).status).toBe(409);
    expect(refused(() => book.confirm("p-nope")).status).toBe(404);
  });

  it("finishes a confirm that died after writing its events", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    // The append happened, then the process stopped before the proposal was marked confirmed.
    store.append([{ id: `${p.id}-0`, at: "2026-12-04T18:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 360, source: "chat", proposal: p.id }]);
    expect(book.get(p.id)?.stale).toBe(false);
    book.confirm(p.id);
    expect(store.events()).toHaveLength(1);
  });

  it("keeps proposals across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "proposals-")), "ruki.proposals.json");
    const first = setup(file);
    const p = first.book.create({ source: "chat", lines: [eggs] });
    const result = first.book.confirm(p.id);
    const again = setup(file, first.store);
    expect(again.book.get(p.id)?.status).toBe("confirmed");
    expect(again.book.confirm(p.id)).toEqual(result);
    expect(first.store.events()).toHaveLength(1);
  });
});
