import type { MenuItem, Order } from "../domain/restaurant.js";
import { explode } from "./plan.js";
import { maxBatch } from "./cost.js";
import type { Catalog, PlanLine, ProductionPlan } from "./types.js";

/** What guests have ordered for `date`, in kitchen units, computed from the orders each time and never stored. */
export function preorderLines(orders: readonly Order[], menu: readonly MenuItem[], date: string): PlanLine[] {
  const lines: PlanLine[] = [];
  for (const m of menu) {
    if (!m.makes) continue;
    let qty = 0;
    for (const o of orders) {
      if (o.pickupDate !== date) continue;
      for (const l of o.items) if (l.id === m.id) qty += l.quantity;
    }
    if (qty <= 0) continue;
    const same = lines.find((l) => l.item === m.makes!.item && l.unit === m.makes!.unit);
    if (same) same.qty += qty;
    else lines.push({ item: m.makes.item, qty, unit: m.makes.unit, source: "preorder" });
  }
  return lines;
}

/** The plan's own lines for the date, then the preorder lines. A preorder line stored in the plan is ignored. */
export function planLines(plan: ProductionPlan | null | undefined, date: string, orders: readonly Order[], menu: readonly MenuItem[]): PlanLine[] {
  const own = (plan?.lines ?? []).filter((l) => l.source !== "preorder").map((l) => ({ ...l, source: "manual" as const }));
  return [...own, ...preorderLines(orders, menu, date)];
}

/** How many more `makes.unit` the kitchen can make once everything already planned for the day is set aside. */
export function orderCapacity(c: Catalog, available: Record<string, number>, planned: PlanLine[], makes: { item: string; unit: string }): number {
  const { uses } = explode(c, planned, available);
  const left: Record<string, number> = Object.create(null);
  for (const [id, n] of Object.entries(available)) left[id] = Math.max(0, n - (uses[id] ?? 0));
  return maxBatch(c, left, makes.item, makes.unit);
}
