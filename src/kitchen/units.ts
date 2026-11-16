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

const own = (table: Record<string, number>, u: string) => (Object.hasOwn(table, u) ? table[u] : undefined);
const lookup = (table: Record<string, number>, u: string) => own(table, u) ?? (u.endsWith("s") ? own(table, u.slice(0, -1)) : undefined);

/** How many base units one `unit` of this item is. */
export function factor(item: Item, unit: string): number {
  const u = unit.trim().toLowerCase();
  const mine = Object.fromEntries(Object.entries(item.units).map(([k, v]) => [k.toLowerCase(), v]));
  const f = lookup(mine, u) ?? lookup(GLOBAL[item.baseUnit], u);
  if (f === undefined || !Number.isFinite(f) || f <= 0) throw new UnitError(`${item.name} can't be measured in "${unit}".`);
  return f;
}

export function toBase(item: Item, qty: number, unit: string): number {
  if (!Number.isFinite(qty) || qty < 0) throw new UnitError(`${qty} isn't a valid amount of ${item.name}.`);
  const base = qty * factor(item, unit);
  if (!Number.isFinite(base)) throw new UnitError(`${qty} ${unit} of ${item.name} is too large.`);
  return base;
}

export const fromBase = (item: Item, base: number, unit: string) => base / factor(item, unit);
