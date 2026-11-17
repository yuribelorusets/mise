import type { Catalog, Item, PlanLine } from "./types.js";
import { itemById } from "./catalog.js";
import { toBase } from "./units.js";

export interface PrepTask { recipe: string; item: string; qty: number; batches: number } // qty in base units of the item made
export interface ShoppingLine { item: string; need: number; have: number; buy: number; buyUnit?: string; buyQty?: number; buyUnitBase?: number; buyBase?: number }
export interface PlanResult { prep: PrepTask[]; shopping: ShoppingLine[]; uses: Record<string, number> }

/** The biggest item-specific unit, e.g. "case" for eggs, used to round the shopping list up. */
const purchaseUnit = (item: Item) => Object.entries(item.units).sort((a, b) => b[1] - a[1])[0];

export function explode(c: Catalog, lines: PlanLine[], available: Record<string, number>): PlanResult {
  const bare = (): Record<string, number> => Object.create(null);
  const have = Object.assign(bare(), available);
  const pool = Object.assign(bare(), available);
  const uses = bare();
  const short = bare();
  const needed = bare();
  const prep = new Map<string, PrepTask>();
  const recipeFor = new Map(c.recipes.map((r) => [r.makes, r]));

  const inProgress: string[] = [];

  const need = (id: string, qty: number) => {
    needed[id] = (needed[id] ?? 0) + qty;
    const take = Math.min(Math.max(pool[id] ?? 0, 0), qty);
    if (take > 0) { pool[id] -= take; uses[id] = (uses[id] ?? 0) + take; }
    const rest = qty - take;
    if (rest <= qty * 1e-9) return; // float error scales with the amount
    const recipe = recipeFor.get(id);
    if (!recipe) return void (short[id] = (short[id] ?? 0) + rest);
    if (inProgress.includes(id)) throw new Error(`Recipe cycle: ${[...inProgress, id].join(" -> ")}.`);
    if (!(recipe.yield.qty > 0)) throw new Error(`Recipe "${recipe.name}": yield must be more than 0.`);
    const batches = rest / toBase(itemById(c, id), recipe.yield.qty, recipe.yield.unit);
    const task = prep.get(recipe.id) ?? { recipe: recipe.id, item: id, qty: 0, batches: 0 };
    task.qty += rest; task.batches += batches;
    prep.set(recipe.id, task);
    inProgress.push(id);
    for (const comp of recipe.components) need(comp.item, toBase(itemById(c, comp.item), comp.qty, comp.unit) * batches);
    inProgress.pop();
  };

  for (const line of lines) need(line.item, toBase(itemById(c, line.item), line.qty, line.unit));

  const shopping = Object.entries(short).map(([id, buy]): ShoppingLine => {
    const line: ShoppingLine = { item: id, need: needed[id], have: Math.max(have[id] ?? 0, 0), buy };
    const pu = purchaseUnit(itemById(c, id));
    if (!pu) return line;
    const buyQty = Math.max(1, Math.ceil((buy / pu[1]) * (1 - 1e-9)));
    return { ...line, buyUnit: pu[0], buyQty, buyUnitBase: pu[1], buyBase: buyQty * pu[1] };
  });
  return { prep: [...prep.values()], shopping, uses };
}
