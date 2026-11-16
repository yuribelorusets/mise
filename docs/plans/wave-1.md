# Wave 1: kitchen core, frontend shell, guardrails

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to work through this task by task. Steps use checkboxes (`- [ ]`).

**Goal:** Build the kitchen's calculation core, the frontend shell with a mockup to approve, and the guardrails and eval tooling, as three packages that don't share files.

**Architecture:** Package A is pure functions over `src/kitchen/types.ts`, plus a file-backed store. Package B is a separate Vite app in `web/` with its own `package.json`. Package C changes the preorder store, ledger and eval runner.

**Tech stack:** TypeScript, vitest, fast-check (A and C). React, Vite, React Router, TanStack Query, Vitest and Testing Library (B).

**Spec:** [docs/design/kitchen-v1.md](../design/kitchen-v1.md) · **Master plan:** [kitchen-v1.md](kitchen-v1.md)

## Global constraints

The master plan's constraints apply. In addition:
- Wave 0 is merged: reservations, Fennel & Ash and the phone channel are gone, and `src/kitchen/types.ts` exists. Don't edit `types.ts`.
- Each package only edits the files listed under "Owns" in the master plan.
- Amounts are base units everywhere inside `src/kitchen/`. Convert at the edges.

---

## Package A: kitchen core

**Branch:** `feat/kitchen-core` · **Agent:** builder · **Owns:** `src/kitchen/**` except `types.ts`, `test/kitchen/**`, `data/kitchens/**`

**Consumes:** `Item`, `Catalog`, `Recipe`, `PlanLine`, `StockEvent`, `KitchenStore` from `src/kitchen/types.ts`, and `MemoryStore` from `src/kitchen/memory-store.ts`.

**Produces** (wave 2 uses these exact names):
- `units.ts`: `class UnitError`, `factor(item, unit): number`, `toBase(item, qty, unit): number`, `fromBase(item, base, unit): number`
- `catalog.ts`: `validateCatalog(c): string[]`, `findItem(c, name): Item | undefined`, `itemById(c, id): Item` (throws if missing)
- `stock.ts`: `type OnHand = Record<string, Record<string, number>>`, `onHand(events): OnHand`, `total(oh, item): number`, `totals(oh): Record<string, number>`, `latestUnitCost(events, item): number | undefined`
- `plan.ts`: `interface PrepTask`, `interface ShoppingLine`, `interface PlanResult`, `explode(c, lines, available): PlanResult`
- `cost.ts`: `batchCost(c, events, item, qty, unit): { cost: number; missing: string[] }`, `maxBatch(c, available, item, unit): number`
- `file-store.ts`: `class FileStore implements KitchenStore`

### Task A1: Units

**Files:** Create `src/kitchen/units.ts`. Test: `test/kitchen/units.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { toBase, fromBase, UnitError } from "../../src/kitchen/units.js";
import type { Item } from "../../src/kitchen/types.js";

const item = (over: Partial<Item>): Item => ({ id: "x", name: "X", aliases: [], baseUnit: "g", units: {}, allergens: [], ...over });
const eggs = item({ id: "eggs", name: "Eggs", baseUnit: "each", units: { case: 180, flat: 30 } });
const flour = item({ id: "flour", name: "Flour" });
const stock = item({ id: "stock", name: "Stock", baseUnit: "ml" });

describe("units", () => {
  it("uses item-specific units", () => expect(toBase(eggs, 2, "case")).toBe(360));
  it("knows kitchen units for each dimension", () => {
    expect(toBase(eggs, 2, "dozen")).toBe(24);
    expect(toBase(flour, 1, "kg")).toBe(1000);
    expect(toBase(flour, 2, "lb")).toBeCloseTo(907.18, 1);
    expect(toBase(stock, 6, "qt")).toBeCloseTo(5678.1, 0);
  });
  it("is forgiving about case, spaces and plurals", () => {
    expect(toBase(eggs, 1, " Cases ")).toBe(180);
    expect(toBase(stock, 2, "quarts")).toBeCloseTo(1892.7, 0);
  });
  it("refuses units from another dimension, and bad amounts", () => {
    expect(() => toBase(flour, 1, "qt")).toThrow(UnitError);
    expect(() => toBase(flour, -1, "g")).toThrow(UnitError);
    expect(() => toBase(flour, Number.NaN, "g")).toThrow(UnitError);
    expect(() => toBase(flour, Infinity, "g")).toThrow(UnitError);
  });
  it("converts back to what it started with", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.constantFrom("g", "kg", "oz", "lb"), (q, u) =>
      Math.abs(fromBase(flour, toBase(flour, q, u), u) - q) <= 1e-9 * Math.max(1, q)));
  });
});
```

- [ ] **Step 2:** `npx vitest run test/kitchen/units.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `src/kitchen/units.ts`

```ts
import type { BaseUnit, Item } from "./types.js";

export class UnitError extends Error {}

const GLOBAL: Record<BaseUnit, Record<string, number>> = {
  g: { g: 1, gram: 1, kg: 1000, kilogram: 1000, oz: 28.349523125, ounce: 28.349523125, lb: 453.59237, lbs: 453.59237, pound: 453.59237 },
  ml: {
    ml: 1, l: 1000, liter: 1000, litre: 1000, tsp: 4.92892159375, teaspoon: 4.92892159375, tbsp: 14.78676478125, tablespoon: 14.78676478125,
    "fl oz": 29.5735295625, cup: 236.5882365, pt: 473.176473, pint: 473.176473, qt: 946.352946, quart: 946.352946, gal: 3785.411784, gallon: 3785.411784,
  },
  each: { each: 1, ea: 1, pc: 1, piece: 1, dozen: 12 },
};

const lookup = (table: Record<string, number>, u: string) => table[u] ?? (u.endsWith("s") ? table[u.slice(0, -1)] : undefined);

/** How many base units one `unit` of this item is. */
export function factor(item: Item, unit: string): number {
  const u = unit.trim().toLowerCase();
  const own = Object.fromEntries(Object.entries(item.units).map(([k, v]) => [k.toLowerCase(), v]));
  const f = lookup(own, u) ?? lookup(GLOBAL[item.baseUnit], u);
  if (!f) throw new UnitError(`${item.name} can't be measured in "${unit}".`);
  return f;
}

export function toBase(item: Item, qty: number, unit: string): number {
  if (!Number.isFinite(qty) || qty < 0) throw new UnitError(`${qty} isn't a valid amount of ${item.name}.`);
  return qty * factor(item, unit);
}

export const fromBase = (item: Item, base: number, unit: string) => base / factor(item, unit);
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Add kitchen units and conversions`

### Task A2: Catalog checks

**Files:** Create `src/kitchen/catalog.ts`. Test: `test/kitchen/catalog.test.ts`.

Rules `validateCatalog` enforces, each returning a readable error string:
- no duplicate ids among items, among locations, among recipes
- every recipe's `makes` and every component's `item` is a known item
- every component unit and every yield unit converts for its item
- `yield.qty > 0`, component `qty > 0`
- at most one recipe makes each item
- no recipe cycle (A needs B needs A, directly or further down)
- every `shelfOrder` id is a known item
- every plan line's item is known and its unit converts

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { validateCatalog, findItem } from "../../src/kitchen/catalog.js";
import type { Catalog } from "../../src/kitchen/types.js";

const base = (): Catalog => ({
  items: [
    { id: "cheese", name: "Farmer's cheese", aliases: ["tvorog", "творог"], baseUnit: "g", units: {}, allergens: ["dairy"] },
    { id: "batter", name: "Syrniki batter", aliases: [], baseUnit: "g", units: {}, allergens: ["dairy"] },
  ],
  locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: ["cheese", "batter"] }],
  recipes: [{ id: "batter", name: "Batter", makes: "batter", yield: { qty: 2, unit: "kg" }, components: [{ item: "cheese", qty: 1, unit: "kg" }] }],
  plans: [],
});

describe("validateCatalog", () => {
  it("accepts a good catalog", () => expect(validateCatalog(base())).toEqual([]));
  it("names unknown items and units", () => {
    const c = base();
    c.recipes[0].components.push({ item: "sugar", qty: 1, unit: "g" }, { item: "cheese", qty: 1, unit: "qt" });
    expect(validateCatalog(c).join("\n")).toMatch(/sugar/);
    expect(validateCatalog(c).join("\n")).toMatch(/qt/);
  });
  it("finds a recipe cycle", () => {
    const c = base();
    c.recipes.push({ id: "cheese", name: "Cheese", makes: "cheese", yield: { qty: 1, unit: "kg" }, components: [{ item: "batter", qty: 1, unit: "kg" }] });
    expect(validateCatalog(c).join("\n")).toMatch(/cycle/i);
  });
  it("rejects two recipes for one item, duplicate ids and zero yields", () => {
    const c = base();
    c.recipes.push({ ...c.recipes[0], id: "batter-2" }, { ...c.recipes[0], yield: { qty: 0, unit: "g" } });
    c.items.push({ ...c.items[0] });
    const errors = validateCatalog(c).join("\n");
    expect(errors).toMatch(/more than one recipe/i);
    expect(errors).toMatch(/duplicate/i);
    expect(errors).toMatch(/yield/i);
  });
});

describe("findItem", () => {
  it("matches names and aliases ignoring case", () => {
    expect(findItem(base(), "TVOROG")?.id).toBe("cheese");
    expect(findItem(base(), "творог")?.id).toBe("cheese");
    expect(findItem(base(), "farmer's cheese")?.id).toBe("cheese");
    expect(findItem(base(), "sugar")).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Run them. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `src/kitchen/catalog.ts`

```ts
import type { Catalog, Item } from "./types.js";
import { factor } from "./units.js";

const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

export function itemById(c: Catalog, id: string): Item {
  const item = c.items.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown item "${id}".`);
  return item;
}

export function findItem(c: Catalog, name: string): Item | undefined {
  const q = name.trim().toLowerCase();
  return c.items.find((i) => i.id === q || i.name.toLowerCase() === q || i.aliases.some((a) => a.toLowerCase() === q));
}

export function validateCatalog(c: Catalog): string[] {
  const errors: string[] = [];
  const items = new Map(c.items.map((i) => [i.id, i]));
  for (const [kind, ids] of [["item", c.items.map((i) => i.id)], ["location", c.locations.map((l) => l.id)], ["recipe", c.recipes.map((r) => r.id)]] as const)
    for (const id of new Set(dupes(ids))) errors.push(`Duplicate ${kind} id "${id}".`);

  const converts = (itemId: string, unit: string, where: string) => {
    const item = items.get(itemId);
    if (!item) return void errors.push(`${where}: unknown item "${itemId}".`);
    try { factor(item, unit); } catch { errors.push(`${where}: ${item.name} can't be measured in "${unit}".`); }
  };

  for (const r of c.recipes) {
    converts(r.makes, r.yield.unit, `Recipe "${r.name}"`);
    if (!(r.yield.qty > 0)) errors.push(`Recipe "${r.name}": yield must be more than 0.`);
    for (const comp of r.components) {
      converts(comp.item, comp.unit, `Recipe "${r.name}"`);
      if (!(comp.qty > 0)) errors.push(`Recipe "${r.name}": ${comp.item} amount must be more than 0.`);
    }
  }
  for (const id of new Set(dupes(c.recipes.map((r) => r.makes)))) errors.push(`More than one recipe makes "${id}".`);
  for (const l of c.locations) for (const id of l.shelfOrder) if (!items.has(id)) errors.push(`Location "${l.name}": unknown item "${id}".`);
  for (const p of c.plans) for (const line of p.lines) converts(line.item, line.unit, `Plan ${p.date}`);

  // Cycles: follow "item -> the items its recipe needs" and look for a way back.
  const needs = new Map(c.recipes.map((r) => [r.makes, r.components.map((x) => x.item)]));
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: string[]): void => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") return void errors.push(`Recipe cycle: ${[...path, id].join(" -> ")}.`);
    state.set(id, "visiting");
    for (const next of needs.get(id) ?? []) visit(next, [...path, id]);
    state.set(id, "done");
  };
  for (const id of needs.keys()) visit(id, []);
  return errors;
}
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Check kitchen catalogs for unknown items, bad units and recipe cycles`

### Task A3: Stock on hand

**Files:** Create `src/kitchen/stock.ts`. Test: `test/kitchen/stock.test.ts`.

Events apply in the order they were appended. On-hand isn't clamped at zero: a negative number means a receive was never logged, and the UI should show that rather than hide it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { onHand, total, totals, latestUnitCost } from "../../src/kitchen/stock.js";
import type { StockEvent } from "../../src/kitchen/types.js";

let n = 0;
const ev = (e: Partial<StockEvent> & Pick<StockEvent, "kind" | "qty">): StockEvent =>
  ({ id: `e${n++}`, at: "2026-12-01T10:00:00Z", item: "eggs", location: "walk-in", source: "manual", ...e });

describe("onHand", () => {
  it("adds receives, subtracts use and waste, and moves between locations", () => {
    const oh = onHand([ev({ kind: "receive", qty: 180 }), ev({ kind: "use", qty: 24 }), ev({ kind: "waste", qty: 6 }), ev({ kind: "move", qty: 30, to: "line" })]);
    expect(oh.eggs).toEqual({ "walk-in": 120, line: 30 });
    expect(total(oh, "eggs")).toBe(150);
  });
  it("lets a count set the amount outright", () => {
    const oh = onHand([ev({ kind: "receive", qty: 180 }), ev({ kind: "count", qty: 50 }), ev({ kind: "use", qty: 10 })]);
    expect(total(oh, "eggs")).toBe(40);
  });
  it("forgets everything before a count, whatever came before", () => {
    const anyEvent = fc.record({ kind: fc.constantFrom("receive", "use", "waste" as const), qty: fc.nat(1000) });
    fc.assert(fc.property(fc.array(anyEvent), fc.nat(1000), (before, counted) =>
      total(onHand([...before.map((e) => ev(e)), ev({ kind: "count", qty: counted })]), "eggs") === counted));
  });
  it("reports totals per item and the latest price paid", () => {
    const events = [ev({ kind: "receive", qty: 180, unitCost: 0.02 }), ev({ kind: "receive", qty: 180, unitCost: 0.025 }), ev({ kind: "receive", item: "flour", qty: 1000 })];
    expect(totals(onHand(events))).toEqual({ eggs: 360, flour: 1000 });
    expect(latestUnitCost(events, "eggs")).toBe(0.025);
    expect(latestUnitCost(events, "flour")).toBeUndefined();
  });
});
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `src/kitchen/stock.ts`

```ts
import type { StockEvent } from "./types.js";

/** item -> location -> amount in base units */
export type OnHand = Record<string, Record<string, number>>;

export function onHand(events: readonly StockEvent[]): OnHand {
  const oh: OnHand = {};
  const at = (item: string) => (oh[item] ??= {});
  for (const e of events) {
    const locs = at(e.item);
    const cur = locs[e.location] ?? 0;
    if (e.kind === "receive") locs[e.location] = cur + e.qty;
    else if (e.kind === "use" || e.kind === "waste") locs[e.location] = cur - e.qty;
    else if (e.kind === "count") locs[e.location] = e.qty;
    else if (e.kind === "move" && e.to) {
      locs[e.location] = cur - e.qty;
      locs[e.to] = (locs[e.to] ?? 0) + e.qty;
    }
  }
  return oh;
}

export const total = (oh: OnHand, item: string) => Object.values(oh[item] ?? {}).reduce((a, b) => a + b, 0);

export const totals = (oh: OnHand): Record<string, number> => Object.fromEntries(Object.keys(oh).map((id) => [id, total(oh, id)]));

export function latestUnitCost(events: readonly StockEvent[], item: string): number | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.item === item && e.kind === "receive" && e.unitCost !== undefined) return e.unitCost;
  }
  return undefined;
}
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Work out stock on hand from the event log`

### Task A4: Prep and shopping lists

**Files:** Create `src/kitchen/plan.ts`. Test: `test/kitchen/plan.test.ts`.

How it works ("netting", the way material planning software does it): walk each plan line. For an item, use what's available first. If that's not enough and a recipe makes the item, the rest becomes a prep task, and its components are needed in proportion. If no recipe makes it, the rest goes on the shopping list. Availability is shared across lines, so two lines can't both use the same batter.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { explode } from "../../src/kitchen/plan.js";
import type { Catalog, PlanLine } from "../../src/kitchen/types.js";

const c: Catalog = {
  items: [
    { id: "cheese", name: "Farmer's cheese", aliases: [], baseUnit: "g", units: {}, allergens: [] },
    { id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: { case: 180 }, allergens: [] },
    { id: "batter", name: "Batter", aliases: [], baseUnit: "g", units: {}, allergens: [] },
    { id: "syrniki", name: "Syrniki", aliases: [], baseUnit: "each", units: { order: 3 }, allergens: [] },
  ],
  locations: [],
  recipes: [
    { id: "batter", name: "Batter", makes: "batter", yield: { qty: 2000, unit: "g" }, components: [{ item: "cheese", qty: 1000, unit: "g" }, { item: "eggs", qty: 4, unit: "each" }] },
    { id: "syrniki", name: "Syrniki", makes: "syrniki", yield: { qty: 1, unit: "order" }, components: [{ item: "batter", qty: 150, unit: "g" }] },
  ],
  plans: [],
};
const plan = (qty: number): PlanLine[] => [{ item: "syrniki", qty, unit: "order", source: "manual" }];

describe("explode", () => {
  it("turns a plan into prep tasks and a shopping list when nothing's on hand", () => {
    const r = explode(c, plan(40), {});
    expect(r.prep).toEqual([
      { recipe: "syrniki", item: "syrniki", qty: 120, batches: 40 },
      { recipe: "batter", item: "batter", qty: 6000, batches: 3 },
    ]);
    expect(r.shopping).toEqual([
      { item: "cheese", need: 3000, have: 0, buy: 3000 },
      { item: "eggs", need: 12, have: 0, buy: 12, buyUnit: "case", buyQty: 1 },
    ]);
  });
  it("uses prepped stock before making more", () => {
    const r = explode(c, plan(40), { batter: 4500, cheese: 10000, eggs: 100 });
    expect(r.prep.find((p) => p.item === "batter")).toEqual({ recipe: "batter", item: "batter", qty: 1500, batches: 0.75 });
    expect(r.shopping).toEqual([]);
    expect(r.uses).toMatchObject({ batter: 4500, cheese: 750, eggs: 3 });
  });
  it("shares stock across lines instead of counting it twice", () => {
    const r = explode(c, [...plan(20), ...plan(20)], { batter: 3000 });
    expect(r.prep.find((p) => p.item === "batter")?.qty).toBe(3000);
  });
  it("needs twice as much for twice the plan, and never asks to buy a negative amount", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 500 }), (q) => {
      const one = explode(c, plan(q), {});
      const two = explode(c, plan(2 * q), {});
      return two.shopping.every((s, i) => Math.abs(s.need - 2 * one.shopping[i].need) < 1e-6 && s.buy >= 0);
    }));
  });
  it("needs nothing when everything is on hand", () => {
    const r = explode(c, plan(10), { syrniki: 30 });
    expect(r.prep).toEqual([]);
    expect(r.shopping).toEqual([]);
  });
});
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `src/kitchen/plan.ts`

```ts
import type { Catalog, Item, PlanLine } from "./types.js";
import { itemById } from "./catalog.js";
import { toBase } from "./units.js";

export interface PrepTask { recipe: string; item: string; qty: number; batches: number } // qty in base units of the item made
export interface ShoppingLine { item: string; need: number; have: number; buy: number; buyUnit?: string; buyQty?: number }
export interface PlanResult { prep: PrepTask[]; shopping: ShoppingLine[]; uses: Record<string, number> }

/** The biggest item-specific unit, e.g. "case" for eggs, used to round the shopping list up. */
const purchaseUnit = (item: Item) => Object.entries(item.units).sort((a, b) => b[1] - a[1])[0];

export function explode(c: Catalog, lines: PlanLine[], available: Record<string, number>): PlanResult {
  const pool = { ...available };
  const uses: Record<string, number> = {};
  const short: Record<string, number> = {};
  const needed: Record<string, number> = {};
  const prep = new Map<string, PrepTask>();
  const recipeFor = new Map(c.recipes.map((r) => [r.makes, r]));

  const need = (id: string, qty: number) => {
    needed[id] = (needed[id] ?? 0) + qty;
    const take = Math.min(Math.max(pool[id] ?? 0, 0), qty);
    if (take > 0) { pool[id] -= take; uses[id] = (uses[id] ?? 0) + take; }
    const rest = qty - take;
    if (rest <= 1e-9) return;
    const recipe = recipeFor.get(id);
    if (!recipe) return void (short[id] = (short[id] ?? 0) + rest);
    const batches = rest / toBase(itemById(c, id), recipe.yield.qty, recipe.yield.unit);
    const task = prep.get(recipe.id) ?? { recipe: recipe.id, item: id, qty: 0, batches: 0 };
    task.qty += rest; task.batches += batches;
    prep.set(recipe.id, task);
    for (const comp of recipe.components) need(comp.item, toBase(itemById(c, comp.item), comp.qty, comp.unit) * batches);
  };

  for (const line of lines) need(line.item, toBase(itemById(c, line.item), line.qty, line.unit));

  const shopping = Object.entries(short).map(([id, buy]): ShoppingLine => {
    const line: ShoppingLine = { item: id, need: needed[id], have: Math.max(available[id] ?? 0, 0), buy };
    const pu = purchaseUnit(itemById(c, id));
    return pu ? { ...line, buyUnit: pu[0], buyQty: Math.ceil(buy / pu[1] - 1e-9) } : line;
  });
  return { prep: [...prep.values()], shopping, uses };
}
```

- [ ] **Step 4:** Run the tests. Expected: PASS. If the property test finds a floating-point edge, keep the tolerance in the test, not a rounding hack in the code.
- [ ] **Step 5:** Commit: `Work out prep and shopping lists from a production plan`

### Task A5: Cost and max batch

**Files:** Create `src/kitchen/cost.ts`. Test: `test/kitchen/cost.test.ts`.

- [ ] **Step 1: Write the failing tests** (reuse the catalog from `plan.test.ts` by moving it to `test/kitchen/fixtures.ts` and exporting it as `syrnikiCatalog`)

```ts
import { describe, it, expect } from "vitest";
import { batchCost, maxBatch } from "../../src/kitchen/cost.js";
import { syrnikiCatalog as c } from "./fixtures.js";
import type { StockEvent } from "../../src/kitchen/types.js";

const receive = (item: string, qty: number, unitCost: number): StockEvent =>
  ({ id: item, at: "2026-12-01T10:00:00Z", kind: "receive", item, location: "walk-in", qty, unitCost, source: "manual" });

describe("cost", () => {
  it("prices a batch from the latest price paid for each raw ingredient", () => {
    const events = [receive("cheese", 1000, 0.012), receive("eggs", 180, 0.05)];
    // 10 orders: 1500 g batter = 0.75 batches = 750 g cheese ($9.00) + 3 eggs ($0.15)
    expect(batchCost(c, events, "syrniki", 10, "order")).toEqual({ cost: 9.15, missing: [] });
  });
  it("lists ingredients with no known price", () => {
    expect(batchCost(c, [receive("cheese", 1000, 0.012)], "syrniki", 10, "order").missing).toEqual(["eggs"]);
  });
  it("says how many whole units you can make from what's on hand", () => {
    expect(maxBatch(c, { cheese: 3000, eggs: 100 }, "syrniki", "order")).toBe(40);
    expect(maxBatch(c, { cheese: 3000, eggs: 8 }, "syrniki", "order")).toBe(26);
    expect(maxBatch(c, {}, "syrniki", "order")).toBe(0);
  });
});
```

(Check the second `maxBatch` number by hand before trusting it: 8 eggs make 2 batches, 4000 g batter, 26 orders.)

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `src/kitchen/cost.ts`

```ts
import type { Catalog, StockEvent } from "./types.js";
import { explode } from "./plan.js";
import { latestUnitCost } from "./stock.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What it costs to make this much from scratch, ignoring what's on hand. */
export function batchCost(c: Catalog, events: readonly StockEvent[], item: string, qty: number, unit: string) {
  const { shopping } = explode(c, [{ item, qty, unit, source: "manual" }], {});
  let cost = 0;
  const missing: string[] = [];
  for (const s of shopping) {
    const price = latestUnitCost(events, s.item);
    if (price === undefined) missing.push(s.item);
    else cost += price * s.need;
  }
  return { cost: round2(cost), missing };
}

/** The most whole `unit`s of an item you can make from what's available. */
export function maxBatch(c: Catalog, available: Record<string, number>, item: string, unit: string, limit = 10_000): number {
  const fits = (n: number) => explode(c, [{ item, qty: n, unit, source: "manual" }], available).shopping.length === 0;
  let lo = 0, hi = limit;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Price batches and work out the most you can make from stock`

### Task A6: File store

**Files:** Create `src/kitchen/file-store.ts`. Test: `test/kitchen/file-store.test.ts`.

The catalog is saved to `<dir>/<kitchen>.catalog.json` by writing a temporary file and renaming it, so a crash mid-write can't leave half a file. Events append to `<dir>/<kitchen>.stock.jsonl`. With no saved catalog, it starts from `data/kitchens/<kitchen>.json`. Bad lines in the event file are skipped with a warning, like the existing ledger.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement** `src/kitchen/file-store.ts`

```ts
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
```

- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `Save the kitchen catalog and stock events to disk`

### Task A7: Ruki's draft catalog and a known-answer test

**Files:** Create `data/kitchens/ruki.json`, `test/kitchen/ruki.test.ts`.

These recipes are **drafts** until the owner sends the real ones. Every recipe gets `"draft": true`, and the test's expected numbers get updated when the real recipes arrive.

- [ ] **Step 1: Write `data/kitchens/ruki.json`** with:
  - items: `farmers-cheese` (g, aliases `tvorog`, `творог`, allergens dairy), `eggs` (each, units `{ "case": 180, "dozen": 12 }`, allergens egg), `flour` (g, gluten), `sugar` (g), `sour-cream` (g, dairy), `jam` (g), `black-tea` (g), `syrniki-batter` (g, dairy/egg/gluten), `syrniki` (each, units `{ "order": 3 }`, dairy/egg/gluten)
  - locations: `walk-in` (shelf order: farmers-cheese, sour-cream, eggs, syrniki-batter, jam), `dry` (flour, sugar, black-tea)
  - recipes: `syrniki-batter` makes 2000 g from farmers-cheese 1000 g, eggs 4 each, flour 200 g, sugar 80 g. `syrniki` makes 1 order from syrniki-batter 150 g, sour-cream 40 g, jam 30 g.
  - plans: `[]`
- [ ] **Step 2: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateCatalog } from "../../src/kitchen/catalog.js";
import { explode } from "../../src/kitchen/plan.js";
import type { Catalog } from "../../src/kitchen/types.js";

const ruki: Catalog = JSON.parse(readFileSync("data/kitchens/ruki.json", "utf8"));

describe("Ruki's catalog", () => {
  it("is valid", () => expect(validateCatalog(ruki)).toEqual([]));
  it("plans 40 orders of syrniki the way I'd write it by hand (draft recipes)", () => {
    const r = explode(ruki, [{ item: "syrniki", qty: 40, unit: "order", source: "manual" }], {});
    expect(r.prep.map((p) => [p.item, p.batches])).toEqual([["syrniki", 40], ["syrniki-batter", 3]]);
    expect(Object.fromEntries(r.shopping.map((s) => [s.item, s.need]))).toEqual({
      "farmers-cheese": 3000, eggs: 12, flour: 600, sugar: 240, "sour-cream": 1600, jam: 1200,
    });
  });
});
```

- [ ] **Step 3:** Run it. Expected: PASS once the data file matches. If it fails, fix the data, not the expected numbers.
- [ ] **Step 4:** Commit: `Add Ruki's draft kitchen catalog with a known-answer test`

---

## Package B: frontend shell and mockup

**Branch:** `feat/web-shell` · **Agent:** frontend-builder · **Owns:** `web/**`, `package.json`, `.github/workflows/ci.yml`

**Consumes:** nothing from the server yet. The mockup uses fixture data.

**Produces:** the app shell wave 2 package F builds on: `web/src/App.tsx` (routes), `web/src/components/TabBar.tsx`, `web/src/components/Layout.tsx`, `web/src/styles/tokens.css`, `web/src/api/client.ts` (`apiGet<T>(path)`, `apiPost<T>(path, body)` via `fetch` with `credentials: "same-origin"`), and the `QueryClientProvider` in `web/src/main.tsx`.

### Task B1: Scaffold `web/`

- [ ] **Step 1:** Create a standalone Vite + React + TypeScript app in `web/` with its own `package.json`. Install current stable versions with `npm --prefix web install` and commit `web/package-lock.json`. Runtime dependencies: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`. Dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`.
- [ ] **Step 2:** `web/vite.config.ts`: the React plugin, `server.proxy` sending `/api` and `/admin` to `http://localhost:3000`, `build.outDir: "dist"`, and a vitest `test` block with `environment: "jsdom"` and a setup file that imports `@testing-library/jest-dom/vitest`.
- [ ] **Step 3:** `web/package.json` scripts: `dev`, `build` (`tsc -b && vite build`), `test` (`vitest run`), `preview`.
- [ ] **Step 4:** Root `package.json` scripts: `"web:dev": "npm --prefix web run dev"`, `"web:build": "npm --prefix web run build"`, `"web:test": "npm --prefix web test"`. Add `web/dist` and `web/node_modules` to `.gitignore` (this one line in `.gitignore` is allowed for package B).
- [ ] **Step 5:** `.github/workflows/ci.yml`: after `npm ci`, add `npm --prefix web ci`, `npm run web:build` and `npm run web:test`.
- [ ] **Step 6:** Check: `npm run web:build` succeeds, and with the build in place `npm start` serves it at `/` (wave 0's `staticDir`). Commit: `Scaffold the React frontend in web/`

### Task B2: Shell, tokens and tab bar

**Files:** `web/src/main.tsx`, `web/src/App.tsx`, `web/src/components/{Layout,TabBar}.tsx`, `web/src/styles/{tokens,base}.css`, `web/src/pages/{Today,Count,Stock,Recipes,Plan,Assistant,Order}.tsx`, `web/src/api/client.ts`. Test: `web/src/components/TabBar.test.tsx`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "../App";

test("the tab bar reaches every owner screen", async () => {
  render(<MemoryRouter initialEntries={["/"]}><AppRoutes /></MemoryRouter>);
  for (const name of ["Today", "Count", "Stock", "Recipes", "Plan"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Count" }));
  expect(screen.getByRole("heading", { level: 1, name: /count/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /assistant/i })).toBeInTheDocument();
});
```

- [ ] **Step 2:** `npm run web:test`. Expected: FAIL.
- [ ] **Step 3:** Build it:
  - `App.tsx` exports `AppRoutes` (the routes `/`, `/count`, `/stock`, `/recipes`, `/plan`, `/assistant`, `/order`) and a default `App` that wraps it in `BrowserRouter`
  - `Layout` renders the page, the bottom `TabBar`, and a floating assistant link
  - each page is a placeholder with its `<h1>`
  - `tokens.css` defines color, spacing, type and radius variables for light and dark (`prefers-color-scheme`), a tabular-figures utility, and `--tap: 44px`
  - `client.ts` exports `apiGet` and `apiPost`, which throw an `ApiError` with the status on a non-2xx response
  - `/order` doesn't show the owner tab bar
- [ ] **Step 4:** `npm run web:test && npm run web:build`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add the app shell, design tokens and tab bar`

### Task B3: Today and Count mockup (stops for approval)

**Files:** `web/src/fixtures/ruki.ts`, `web/src/pages/Today.tsx`, `web/src/pages/Count.tsx`, `web/src/components/{PrepList,QtyInput}.tsx` and their CSS. Tests: `web/src/components/QtyInput.test.tsx`, `web/src/pages/Today.test.tsx`.

The mockup uses fixture data shaped like package A's results (`PrepTask`, `ShoppingLine`), so wiring it up in wave 2 is a data swap. The fixtures are Saturday's pop-up: 40 syrniki and 30 nalysnyky, with prep tasks, three shortfalls, and six preorders across pickup windows. For the walk-in count: about ten items in shelf order, each with its unit.

- [ ] **Step 1: Write the failing tests**

```tsx
// QtyInput.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QtyInput } from "./QtyInput";

test("steps with buttons, accepts typing, and never goes below zero", async () => {
  const changes: number[] = [];
  render(<QtyInput label="Eggs" unit="each" value={1} onChange={(v) => changes.push(v)} />);
  await userEvent.click(screen.getByRole("button", { name: /less eggs/i }));
  await userEvent.click(screen.getByRole("button", { name: /less eggs/i }));
  expect(changes.at(-1)).toBe(0);
  const box = screen.getByRole("spinbutton", { name: /eggs/i });
  await userEvent.clear(box);
  await userEvent.type(box, "36");
  expect(changes.at(-1)).toBe(36);
});
```

```tsx
// Today.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Today from "./Today";

test("shows the prep list and what's short", () => {
  render(<MemoryRouter><Today /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: /prep/i })).toBeInTheDocument();
  expect(screen.getByText(/syrniki batter/i)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /short/i })).toBeInTheDocument();
});
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Build both screens with the frontend-design skill, following the design direction in the agent definition. Prep rows are checkable, and checked rows stay visible but are struck through. Quantities sit in a right-aligned column with tabular figures and units in a muted column after them. Count has a location switcher at the top and big `QtyInput` rows.
- [ ] **Step 4:** `npm run web:test && npm run web:build`, then check both screens at 375 px and at desktop width.
- [ ] **Step 5:** Commit: `Add the Today and Count mockup`
- [ ] **Step 6: Stop.** Report how to view it (`npm run web:dev`, then `/` and `/count`) with a short description of the design choices. The orchestrator shows it to the owner, and further screens wait for their approval.

---

## Package C: guardrails and eval tooling

**Branch:** `feat/guardrails` · **Agent:** builder · **Owns:** `src/domain/restaurant.ts`, `src/ops/ledger.ts`, `src/ops/guardrails.ts`, `src/evals/run.ts`, `src/server.ts`, `data/restaurants/ruki.json`, `scripts/loadtest.ts`, `test/evals.test.ts`, `test/popup.test.ts`, `test/server.test.ts`, `test/robustness.test.ts`

### Task C1: Per-phone and per-item preorder caps

Fake phone numbers can't be stopped without payment, but a cap per phone number and per item keeps one person from taking the whole batch with one number.

**Files:** `src/domain/restaurant.ts` (`placeOrder`, the `popup` config type), `data/restaurants/ruki.json`. Test: `test/popup.test.ts`.

- [ ] **Step 1: Write the failing tests** in `test/popup.test.ts`

```ts
it("caps preorders per phone number, however it's formatted", () => {
  const s = new RestaurantStore(ruki);
  const place = (phone: string, sessionId: string) =>
    s.placeOrder({ name: "Anya", phone, items: [{ item: "syrniki", quantity: 1 }], pickupTime: "11:00", sessionId }, BEFORE_CUTOFF);
  place("510-555-0100", "a");
  place("(510) 555-0100", "b");
  expect(() => place("+1 510.555.0100", "c")).toThrow(/already has 2 preorders/);
  expect(() => place("510-555-0199", "d")).not.toThrow();
});

it("caps how many of one item a single order can take", () => {
  const s = new RestaurantStore(ruki);
  expect(() => order(s, "syrniki", 7)).toThrow(/at most 6/);
  expect(() => order(s, "syrniki", 6)).not.toThrow();
});
```

- [ ] **Step 2:** `npx vitest run test/popup.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `maxOrdersPerPhone?: number` (default 2) and `maxPerItem?: number` (default 6) to the `popup` config type, and set both in `ruki.json`. In `placeOrder`, after the duplicate check and before the stock check:

```ts
const digits = (p: string) => p.replace(/\D/g, "").slice(-10);
const maxPerPhone = this.config.popup?.maxOrdersPerPhone ?? 2;
const fromPhone = this.orders.filter((x) => digits(x.phone) === digits(o.phone)).length;
if (fromPhone >= maxPerPhone)
  throw new Error(`This phone number already has ${fromPhone} preorders. To change one, message us${this.config.instagram ? ` on Instagram (${this.config.instagram})` : ""}.`);
const maxPerItem = this.config.popup?.maxPerItem ?? 6;
for (const [id, quantity] of qty) if (quantity > maxPerItem)
  throw new Error(`One order can include at most ${maxPerItem} of ${this.findItem(id)!.name}.`);
```

(`qty` is the merged map of id to quantity that `placeOrder` already builds.)

Eval setup orders (`setup.orders` in a scenario, like the 20 and 18 syrniki in `redteam-nearly-sold-out`) stand in for many guests who already ordered, so they skip the caps. Give `placeOrder` a third parameter, `opts: { caps?: boolean } = {}`, check the caps only when `opts.caps !== false`, and pass `{ caps: false }` from the setup loop in `runScenario` (`src/evals/run.ts`, which package C owns). Guest-facing code never passes it.

- [ ] **Step 4:** `npm test`. Expected: PASS. If the load test or a property test now fails because it reuses one phone number, give it distinct numbers. The test was relying on a missing rule.
- [ ] **Step 5:** Commit: `Cap preorders per phone number and per item`

### Task C2: Data retention

**Files:** `src/ops/ledger.ts`, `src/server.ts`. Test: `test/popup.test.ts`.

`Ledger.compact(now, retainDays)` rewrites the file, writing a temporary file and renaming it:
- turn entries older than `retainDays` are dropped
- older orders are kept for totals, but `name` becomes `"[removed]"` and `phone` becomes `""`
- `createApp` calls it once at startup when the ledger is persistent, with `MISE_RETAIN_DAYS` (default 90)

- [ ] **Step 1: Write the failing test**

```ts
it("drops old chats and removes names and phones from old orders", () => {
  const dir = mkdtempSync(join(tmpdir(), "mise-"));
  const now = new Date("2026-12-04T18:00:00-08:00");
  const old = "2026-08-01T00:00:00Z", recent = "2026-12-01T00:00:00Z";
  const line = (o: object) => JSON.stringify(o) + "\n";
  appendFileSync(join(dir, "ruki.jsonl"),
    line({ kind: "turn", at: old, value: { at: old, sessionId: "a", user: "hi", reply: "hello" } }) +
    line({ kind: "turn", at: recent, value: { at: recent, sessionId: "b", user: "hi", reply: "hello" } }) +
    line({ kind: "order", at: old, value: { id: "RK-OLD001", name: "Anya", phone: "510-555-0100", items: [], total: 12 } }));
  new Ledger(dir, "ruki").compact(now, 90);
  const after = new Ledger(dir, "ruki");
  expect(after.turns.map((t) => t.sessionId)).toEqual(["b"]);
  expect(after.orders[0]).toMatchObject({ id: "RK-OLD001", name: "[removed]", phone: "", total: 12 });
  expect(readFileSync(join(dir, "ruki.jsonl"), "utf8")).not.toMatch(/510-555-0100/);
});
```

- [ ] **Step 2:** Run it. Expected: FAIL, `compact` is not a function.
- [ ] **Step 3: Implement** `compact` in `Ledger`. Keep the raw entries the constructor read (`private entries: Entry[]`), filter and redact them, write `${file}.tmp`, rename it over the file, then reload the in-memory arrays from the filtered entries. Call it in `createApp`: `if (ledger.persistent) ledger.compact(new Date(), Number(process.env.MISE_RETAIN_DAYS ?? 90));`
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Delete old chats and remove guest details from old orders`

### Task C3: Privacy notice

**Files:** `src/server.ts` (`/api/config`). Test: `test/server.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it("tells guests what's kept and for how long", async () => {
  process.env.MISE_RETAIN_DAYS = "60";
  const app = await start(createApp({ llm: new MockLLM(), webhook: quiet() }));
  const cfg = await (await fetch(`${app.url}/api/config`)).json();
  app.close();
  delete process.env.MISE_RETAIN_DAYS;
  expect(cfg.privacyNotice).toMatch(/60 days/);
  expect(cfg.privacyNotice).toMatch(/name and phone/i);
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** `/api/config` adds `privacyNotice`: `We keep your name and phone number to prepare your order, and remove them after ${days} days. Chats are saved for the same time to improve the assistant.` Use the same `MISE_RETAIN_DAYS` value as C2. Wave 2 package F renders it on `/order`.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Add a privacy notice to the chat config`

### Task C4: The `live` tag

**Files:** `src/evals/run.ts`. Test: `test/evals.test.ts`.

- [ ] **Step 1: Write the failing test** in `test/evals.test.ts`

```ts
it("skips scenarios tagged live on the mock instead of faking a pass", async () => {
  const r = await runScenario({ id: "needs-claude", restaurant: "ruki", tags: ["live"], turns: ["hi"], expect: { reply_matches: ["never"] } }, { label: "mock", llm: "mock" });
  expect(r.skipped).toBe(true);
});
```

- [ ] **Step 2:** Run it. Expected: FAIL (it runs and fails the regex).
- [ ] **Step 3: Implement.** In `runScenario`, skip on the mock when `s.simulate || s.tags?.includes("live")`, with the same skipped result shape the simulated case returns now. Update the skip message in `main` to say "needs a real model".
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `Let scenarios that need a real model skip the mock`

### Task C5: `--max-usd`

**Files:** `src/evals/run.ts`. Test: `test/evals.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { SpendMeter } from "../src/evals/run.js";

it("stops spending once the cap is reached", () => {
  const m = new SpendMeter(0.05);
  m.add("anthropic:claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 0 }); // $0.01
  expect(m.exceeded).toBe(false);
  m.add("anthropic:claude-sonnet-5-5", { input_tokens: 20_000, output_tokens: 1_000 }); // $0.05
  expect(m.exceeded).toBe(true);
  expect(m.spent).toBeCloseTo(0.06, 5);
});
```

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Export `SpendMeter` from `run.ts`, using `costUsd` from `src/ops/pricing.ts`: `add(model, usage)`, `spent`, and `exceeded`, which is `spent >= max`.
  - `runScenario` adds `usage: { input_tokens, output_tokens }` to `ScenarioResult` (sum them in `say`), plus `model: llm.name`.
  - `main` takes `--max-usd` (no default). Before each scenario, if the meter is exceeded, print `Stopped: spent $X of the $Y cap` and stop all loops. After each result, `meter.add(r.model, r.usage)`. The summary prints `spent $X`. Reports are still written, and the exit code is `2` if the run was stopped early.
- [ ] **Step 4:** `npm test`, then `npm run eval -- --llm mock --max-usd 0.01`. Expected: PASS and a full mock run, since the mock costs $0.
- [ ] **Step 5:** Commit: `Add a spending cap to the eval runner`

---

## Done when

- All three branches are merged into `main` following the master plan's protocol, with reviewer and security-reviewer findings handled.
- `npm run typecheck && npm test && npm run loadtest -- 300 50 && npm run web:build && npm run web:test` passes on `main`.
- The owner has approved, or redirected, the Today and Count mockup.
- The wave 2 task plan is written against what actually merged.
