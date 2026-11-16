import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "../../src/kitchen/file-store.js";

const seed = { items: [{ id: "eggs", name: "Eggs", aliases: [], baseUnit: "each" as const, units: {}, allergens: [] }], locations: [], recipes: [], plans: [] };

describe("FileStore", () => {
  it("keeps the catalog and events across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitchen-"));
    const a = new FileStore(dir, "test", seed);
    a.append([{ id: "e1", at: "2026-12-01T10:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 12, source: "manual" }]);
    a.saveCatalog({ ...seed, locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: ["eggs"] }] });
    const b = new FileStore(dir, "test", seed);
    expect(b.events()).toHaveLength(1);
    expect(b.catalog().locations).toHaveLength(1);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("skips a corrupt line instead of refusing to start", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitchen-"));
    appendFileSync(join(dir, "test.stock.jsonl"), "{not json\n");
    expect(new FileStore(dir, "test", seed).events()).toEqual([]);
  });
  it("names the file when the catalog can't be parsed", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitchen-"));
    writeFileSync(join(dir, "test.catalog.json"), "{oops");
    expect(() => new FileStore(dir, "test", seed)).toThrow(/test\.catalog\.json/);
  });
  it("refuses to load or save an invalid catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "kitchen-"));
    const cyclic = {
      ...seed,
      items: [...seed.items, { ...seed.items[0], id: "a", name: "A" }, { ...seed.items[0], id: "b", name: "B" }],
      recipes: [
        { id: "a", name: "A", makes: "a", yield: { qty: 1, unit: "each" }, components: [{ item: "b", qty: 1, unit: "each" }] },
        { id: "b", name: "B", makes: "b", yield: { qty: 1, unit: "each" }, components: [{ item: "a", qty: 1, unit: "each" }] },
      ],
    };
    const store = new FileStore(dir, "test", seed);
    store.saveCatalog({ ...seed, locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: [] }] });
    expect(() => store.saveCatalog(cyclic)).toThrow(/cycle/i);
    expect(new FileStore(dir, "test", seed).catalog().locations).toHaveLength(1);
    writeFileSync(join(dir, "bad.catalog.json"), JSON.stringify(cyclic));
    expect(() => new FileStore(dir, "bad", seed)).toThrow(/cycle/i);
  });
});
