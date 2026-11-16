import { toBase } from "../fixtures/items";
import type { Component, Recipe } from "../fixtures/types";

export interface Cost {
  /** Dollars, counting only the ingredients with a known price. */
  total: number;
  /** Item ids with no known price, including ones inside sub-recipes. */
  unpriced: string[];
}

export function componentCost(
  c: Component,
  recipes: readonly Recipe[],
  prices: Record<string, number>,
  seen: readonly string[] = [],
): Cost {
  const qty = toBase(c.item, c.qty, c.unit) ?? 0;
  const sub = recipes.find((r) => r.makes === c.item);
  if (sub && !seen.includes(sub.id)) {
    const batch = recipeCost(sub, recipes, prices, seen);
    const made = toBase(sub.makes, sub.yield.qty, sub.yield.unit) ?? 0;
    return { total: made > 0 ? (batch.total / made) * qty : 0, unpriced: batch.unpriced };
  }
  const price = prices[c.item];
  return price === undefined ? { total: 0, unpriced: [c.item] } : { total: price * qty, unpriced: [] };
}

export function recipeCost(
  recipe: Recipe,
  recipes: readonly Recipe[],
  prices: Record<string, number>,
  seen: readonly string[] = [],
): Cost {
  const parts = recipe.components.map((c) => componentCost(c, recipes, prices, [...seen, recipe.id]));
  return {
    total: parts.reduce((sum, p) => sum + p.total, 0),
    unpriced: [...new Set(parts.flatMap((p) => p.unpriced))],
  };
}

/** The cost of one of what the recipe yields: a plate, or a kg or L of a prep item. */
export function unitCost(recipe: Recipe, batch: number): { label: string; value: number } {
  const { qty, unit } = recipe.yield;
  if (qty <= 0) return { label: "plate", value: 0 };
  if (unit === "g" || unit === "ml") return { label: unit === "g" ? "kg" : "L", value: (batch / qty) * 1000 };
  if (unit === "kg" || unit === "L") return { label: unit, value: batch / qty };
  return { label: "plate", value: batch / qty };
}
