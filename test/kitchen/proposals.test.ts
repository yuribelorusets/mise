import { describe, it, expect } from "vitest";
import { MemoryStore } from "../../src/kitchen/memory-store.js";
import { ProposalBook, ProposalError } from "../../src/kitchen/proposals.js";
import type { Catalog, ProposalLine, StockEvent } from "../../src/kitchen/types.js";

const catalog: Catalog = {
  items: [{ id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: { case: 180 }, allergens: [] }],
  locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: ["eggs"] }],
  recipes: [],
  plans: [],
};
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
