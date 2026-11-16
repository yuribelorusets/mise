import type { ToolSpec } from "../../llm/types.js";
import { findItem } from "../catalog.js";
import { batchCost, maxBatch } from "../cost.js";
import { explode } from "../plan.js";
import { onHand, totals } from "../stock.js";
import { toBase } from "../units.js";
import type { ProposalBook } from "../proposals.js";
import type { Catalog, Item, KitchenStore, NewItemOffer, ProposalView } from "../types.js";

export interface KitchenToolContext {
  store: KitchenStore;
  proposals: ProposalBook;
  /** YYYY-MM-DD */
  today: string;
  /** What this turn produced, for the reply. */
  offers: NewItemOffer[];
  proposed: ProposalView[];
}

export interface KitchenToolResult { content: unknown; isError: boolean }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

export const KITCHEN_TOOLS: ToolSpec[] = [
  {
    name: "find_item",
    description: "Look an item up by name, alias or id. Returns its id, base unit and own units, or says it isn't in the catalog.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "on_hand",
    description: "What is in stock now, in base units. With an item: its total and amount per location. Without: every item with stock.",
    input_schema: { type: "object", properties: { item: { type: "string" }, location: { type: "string", description: "A location id or name, to look at one place." } } },
  },
  {
    name: "shopping_list",
    description: "What to buy for a production plan, in base units, after using what's on hand. Defaults to the next plan from today.",
    input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } } },
  },
  {
    name: "prep_list",
    description: "The prep tasks (sub-recipes to make, with batches) for a production plan. Defaults to the next plan from today.",
    input_schema: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" } } },
  },
  {
    name: "max_batch",
    description: "The most whole units of an item the current stock can make. max is null when stock doesn't limit it.",
    input_schema: { type: "object", properties: { item: { type: "string" }, unit: { type: "string" } }, required: ["item"] },
  },
  {
    name: "cost",
    description: "What a batch costs from the latest prices paid: total, per unit, and the items with no price yet.",
    input_schema: { type: "object", properties: { item: { type: "string" }, qty: { type: "number" }, unit: { type: "string" } }, required: ["item", "qty", "unit"] },
  },
  {
    name: "propose_stock_changes",
    description: "Put stock changes on a card for the owner. Nothing is booked until the owner confirms the card. Keep the owner's own units.",
    input_schema: {
      type: "object",
      properties: {
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["receive", "use", "waste", "count", "move"] },
              item: { type: "string" },
              qty: { type: "number" },
              unit: { type: "string" },
              location: { type: "string" },
              to: { type: "string" },
              unitCost: { type: "number" },
              raw: { type: "string", description: "The owner's words for this line." },
            },
            required: ["kind", "item", "qty", "unit"],
          },
        },
      },
      required: ["lines"],
    },
  },
  {
    name: "offer_new_item",
    description: "Offer to add an item that isn't in the catalog. Nothing is added until the owner taps Add.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, baseUnit: { type: "string", enum: ["g", "ml", "each"] }, raw: { type: "string" } },
      required: ["name", "baseUnit"],
    },
  },
];

class ToolError extends Error {}

const ok = (content: unknown): KitchenToolResult => ({ content, isError: false });
const fail = (error: string, extra: Record<string, unknown> = {}): KitchenToolResult => ({ content: { error, ...extra }, isError: true });

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim()) throw new ToolError(`${what} is missing.`);
  return v;
}

function resolve(c: Catalog, name: unknown): Item {
  const x = str(name, "The item name").trim();
  const item = c.items.find((i) => i.id === x) ?? findItem(c, x);
  if (!item) throw new ToolError(`"${x}" isn't in the catalog. Ask the owner whether to add it (offer_new_item).`);
  return item;
}

function amount(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ToolError(`${String(v)} isn't a valid amount.`);
  return v;
}

/** The plan on `date`, or the next one on or after today. */
function planFor(c: Catalog, today: string, date: unknown) {
  if (date !== undefined && (typeof date !== "string" || !DATE.test(date))) throw new ToolError("The date must look like 2026-12-05.");
  const plans = c.plans.filter((p) => (date ? p.date === date : p.date >= today)).sort((a, b) => a.date.localeCompare(b.date));
  if (!plans.length) return undefined;
  const day = plans[0].date;
  return { date: day, lines: plans.filter((p) => p.date === day).flatMap((p) => p.lines) };
}

function readTool(name: string, input: Record<string, unknown>, ctx: KitchenToolContext): KitchenToolResult {
  const c = ctx.store.catalog();
  switch (name) {
    case "find_item": {
      const q = str(input.name, "The name").trim();
      const item = c.items.find((i) => i.id === q) ?? findItem(c, q);
      if (!item) return ok({ found: false, hint: "Not in the catalog. Ask the owner whether to add it (offer_new_item). Don't pick a similar item." });
      return ok({ found: true, item: { id: item.id, name: item.name, baseUnit: item.baseUnit, units: item.units } });
    }
    case "on_hand": {
      const oh = onHand(ctx.store.events());
      let where: string | undefined;
      if (input.location !== undefined) {
        const q = str(input.location, "The location").trim().toLowerCase();
        const loc = c.locations.find((l) => l.id === q || l.name.toLowerCase() === q);
        if (!loc) throw new ToolError(`"${q}" isn't a storage location. They are: ${c.locations.map((l) => l.name).join(", ")}.`);
        where = loc.id;
      }
      const here = (id: string) => Object.entries(oh[id] ?? {}).filter(([l]) => !where || l === where);
      if (input.item !== undefined) {
        const item = resolve(c, input.item);
        const byLocation = Object.fromEntries(here(item.id));
        return ok({ item: item.id, name: item.name, baseUnit: item.baseUnit, total: Object.values(byLocation).reduce((a, b) => a + b, 0), byLocation });
      }
      const items = c.items
        .map((i) => ({ item: i.id, name: i.name, baseUnit: i.baseUnit, total: here(i.id).reduce((a, [, q]) => a + q, 0) }))
        .filter((r) => r.total !== 0)
        .slice(0, 100);
      return ok({ items });
    }
    case "shopping_list": {
      const plan = planFor(c, ctx.today, input.date);
      if (!plan) return ok({ date: null, lines: [], note: input.date ? `No production plan on ${String(input.date)}.` : "No production plan ahead." });
      const { shopping } = explode(c, plan.lines, totals(onHand(ctx.store.events())));
      const lines = shopping.map((s) => {
        const item = resolve(c, s.item);
        return { item: s.item, name: item.name, baseUnit: item.baseUnit, need: s.need, have: s.have, buy: s.buy, ...(s.buyQty !== undefined ? { buyQty: s.buyQty, buyUnit: s.buyUnit } : {}) };
      });
      return ok({ date: plan.date, lines });
    }
    case "prep_list": {
      const plan = planFor(c, ctx.today, input.date);
      if (!plan) return ok({ date: null, tasks: [], note: input.date ? `No production plan on ${String(input.date)}.` : "No production plan ahead." });
      const { prep } = explode(c, plan.lines, totals(onHand(ctx.store.events())));
      return ok({ date: plan.date, tasks: prep.map((t) => ({ ...t, recipeName: c.recipes.find((r) => r.id === t.recipe)?.name ?? t.recipe, name: resolve(c, t.item).name })) });
    }
    case "max_batch": {
      const item = resolve(c, input.item);
      const unit = input.unit === undefined ? (Object.keys(item.units)[0] ?? item.baseUnit) : str(input.unit, "The unit");
      toBase(item, 1, unit);
      const limit = 10_000;
      const max = maxBatch(c, totals(onHand(ctx.store.events())), item.id, unit, limit);
      return ok({ item: item.id, name: item.name, unit, max: max >= limit ? null : max });
    }
    case "cost": {
      const item = resolve(c, input.item);
      const qty = amount(input.qty);
      if (!(qty > 0)) throw new ToolError("The amount must be more than 0.");
      const unit = str(input.unit, "The unit");
      toBase(item, qty, unit);
      const r = batchCost(c, ctx.store.events(), item.id, qty, unit);
      return ok({ item: item.id, name: item.name, qty, unit, cost: r.cost, perUnit: round2(r.cost / qty), missing: r.missing.map((id) => c.items.find((i) => i.id === id)?.name ?? id) });
    }
  }
  return fail(`Unknown tool "${name}".`);
}

export function runKitchenTool(name: string, input: Record<string, unknown>, ctx: KitchenToolContext): KitchenToolResult {
  if (!KITCHEN_TOOLS.some((t) => t.name === name)) return fail(`Unknown tool "${name}".`);
  if (typeof input !== "object" || input === null || Array.isArray(input)) return fail("The tool input must be an object.");
  try {
    if (name === "propose_stock_changes" || name === "offer_new_item") return fail("This tool isn't available yet.");
    return readTool(name, input, ctx);
  } catch (e) {
    // Unit and recipe errors carry sentences the model can repeat.
    return fail(e instanceof Error ? e.message : "That didn't work.");
  }
}
