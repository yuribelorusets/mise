import type { Catalog, Item } from "./types.js";
import { factor } from "./units.js";

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const RU: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** The id an item with this name is saved under, or "" when the name has no letters or digits to build one from. */
export function itemIdFor(name: string): string {
  // Compose first so й and ё are one character for the table, then split what's left to drop accents (é, ñ).
  const latin = [...name.toLowerCase().normalize("NFC")].map((ch) => RU[ch] ?? ch).join("").normalize("NFD").replace(/[̀-ͯ]/g, "");
  return latin.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

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
    {
      for (const id of new Set(dupes(ids))) errors.push(`Duplicate ${kind} id "${id}".`);
      for (const id of new Set(ids)) if (typeof id !== "string" || !ID_PATTERN.test(id)) errors.push(`The ${kind} id "${id}" must be lowercase words joined by dashes.`);
    }

  for (const i of c.items)
    for (const [unit, f] of Object.entries(i.units))
      if (!(Number.isFinite(f) && f > 0)) errors.push(`Item "${i.name}": unit "${unit}" must be a positive number.`);

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
