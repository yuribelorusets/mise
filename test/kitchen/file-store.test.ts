import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, appendFileSync } from "node:fs";
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
});
