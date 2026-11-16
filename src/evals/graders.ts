import { detectLang } from "../llm/lang.js";
import type { ToolCallTrace } from "../agent/agent.js";
import type { RestaurantStore } from "../domain/restaurant.js";
import type { ProposalBook } from "../kitchen/proposals.js";
import { toBase } from "../kitchen/units.js";
import type { Catalog, KitchenStore, NewItemOffer, StockKind } from "../kitchen/types.js";

export interface Expectation {
  tools_called?: { name: string; input?: Record<string, unknown> }[];
  tools_not_called?: string[];
  reply_matches?: string[];
  reply_must_not_include?: string[];
  events?: string[];
  language?: "en" | "es" | "ru" | "fr";
  /** Grade the outcome, not the path: what's in the store when the conversation ends. */
  end_state?: {
    new_orders?: number;
    order?: { pickupTime?: string; total?: number; items?: Record<string, number> }; // the last new order
    no_items_with_allergen?: string;
  };
  /** Grade the kitchen assistant by what it left behind. */
  kitchen_end_state?: {
    proposals?: number; // open proposals at the end
    lines?: { kind?: StockKind; item: string; base: number }[]; // across open proposals, in base units, within 0.5%
    no_line_for?: string[]; // item ids that must not appear on any proposal
    events_written?: number; // stock events written by the conversation
    offers?: string[]; // names offered as new items, ignoring case
    catalog_unchanged?: boolean;
    reply_numbers_from?: string; // a tool name: every number in the reply must appear in that tool's output
  };
}

export interface KitchenEnd {
  store: KitchenStore;
  proposals: ProposalBook;
  catalogBefore: Catalog;
  eventsBefore: number;
  offers: NewItemOffer[];
  reply: string;
  calls: ToolCallTrace[];
}

export interface EndState { store: RestaurantStore; ordersBefore: number }

export interface Check { check: string; pass: boolean; detail?: string }

/** true when every key in `want` is present in `got` with an equal value (arrays: `got` contains every item). */
export function subset(want: unknown, got: unknown): boolean {
  if (Array.isArray(want)) return Array.isArray(got) && want.every((w) => got.some((g) => subset(w, g)));
  if (want && typeof want === "object")
    return !!got && typeof got === "object" && Object.entries(want).every(([k, v]) => subset(v, (got as Record<string, unknown>)[k]));
  return String(want).toLowerCase() === String(got).toLowerCase();
}

/** Supports a leading (?i) flag, which JavaScript regexes don't accept inline. */
const toRegex = (p: string) => (p.startsWith("(?i)") ? new RegExp(p.slice(4), "i") : new RegExp(p));

export function grade(exp: Expectation, reply: string, calls: ToolCallTrace[], events: string[], end?: EndState): Check[] {
  const checks: Check[] = [];
  if (exp.end_state && end) checks.push(...gradeEndState(exp.end_state, end));
  for (const t of exp.tools_called ?? []) {
    const hit = calls.find((c) => c.name === t.name && !c.isError && (!t.input || subset(t.input, c.input)));
    checks.push({
      check: `called ${t.name}${t.input ? " " + JSON.stringify(t.input) : ""}`,
      pass: !!hit,
      detail: hit ? undefined : `calls: ${calls.map((c) => `${c.name}${JSON.stringify(c.input)}${c.isError ? "!" : ""}`).join(", ") || "none"}`,
    });
  }
  for (const name of exp.tools_not_called ?? []) {
    const hit = calls.find((c) => c.name === name && !c.isError);
    checks.push({ check: `did not call ${name}`, pass: !hit, detail: hit ? JSON.stringify(hit.input) : undefined });
  }
  for (const p of exp.reply_matches ?? []) checks.push({ check: `reply matches /${p}/`, pass: toRegex(p).test(reply) });
  for (const s of exp.reply_must_not_include ?? [])
    checks.push({ check: `reply omits "${s}"`, pass: !reply.toLowerCase().includes(s.toLowerCase()) });
  for (const e of exp.events ?? []) checks.push({ check: `emitted ${e}`, pass: events.includes(e) });
  if (exp.language) {
    const got = detectLang(reply);
    checks.push({ check: `replied in ${exp.language}`, pass: got === exp.language, detail: got === exp.language ? undefined : `detected ${got}` });
  }
  return checks;
}

function gradeEndState(want: NonNullable<Expectation["end_state"]>, { store, ordersBefore }: EndState): Check[] {
  const checks: Check[] = [];
  const orders = store.orders.slice(ordersBefore);
  const show = (o: unknown) => JSON.stringify(o);
  if (want.new_orders !== undefined)
    checks.push({ check: `end state: ${want.new_orders} new order(s)`, pass: orders.length === want.new_orders, detail: `got ${orders.length}: ${show(orders.map((o) => o.items.map((l) => `${l.quantity}x${l.id}`)))}` });
  if (want.order) {
    const o = orders.at(-1);
    const items = o && Object.fromEntries(o.items.map((l) => [l.id, l.quantity]));
    const pass = !!o
      && (want.order.pickupTime === undefined || o.pickupTime === want.order.pickupTime)
      && (want.order.total === undefined || o.total === want.order.total)
      && (want.order.items === undefined || show(Object.entries(want.order.items).sort()) === show(Object.entries(items!).sort()));
    checks.push({ check: `end state: order ${show(want.order)}`, pass, detail: o ? `got ${show({ pickupTime: o.pickupTime, total: o.total, items })}` : "no order" });
  }
  if (want.no_items_with_allergen) {
    const a = want.no_items_with_allergen;
    const bad = orders.flatMap((o) => o.items).filter((l) => store.config.menu.find((m) => m.id === l.id)?.allergens.includes(a));
    checks.push({ check: `end state: nothing ordered contains ${a}`, pass: !bad.length, detail: bad.length ? show(bad.map((l) => l.name)) : undefined });
  }
  return checks;
}

const NUMBER = /\d+(?:\.\d+)?/g;
const numbersIn = (text: string) => (text.match(NUMBER) ?? []).map(Number);

export function gradeKitchen(want: NonNullable<Expectation["kitchen_end_state"]>, end: KitchenEnd): Check[] {
  const checks: Check[] = [];
  const catalog = end.store.catalog();
  const open = end.proposals.list("open");
  const baseOf = (l: { item: string; qty: number; unit: string }) => {
    const item = catalog.items.find((i) => i.id === l.item);
    try { return item ? toBase(item, l.qty, l.unit) : NaN; } catch { return NaN; }
  };
  if (want.proposals !== undefined)
    checks.push({ check: `kitchen: ${want.proposals} open proposal(s)`, pass: open.length === want.proposals, detail: `got ${open.length}` });
  for (const w of want.lines ?? []) {
    const got = open.flatMap((p) => p.lines).filter((l) => l.item === w.item && (!w.kind || l.kind === w.kind));
    const bases = got.map(baseOf);
    checks.push({
      check: `kitchen: ${w.kind ? `a ${w.kind} line` : "a line"} for ${w.item} of ${w.base}`,
      pass: bases.some((b) => Math.abs(b - w.base) <= 0.005 * Math.max(Math.abs(w.base), 1)),
      detail: `got ${bases.length ? bases.join(", ") : "no line"}`,
    });
  }
  if (want.no_line_for) {
    const used = new Set(end.proposals.list().flatMap((p) => p.lines.map((l) => l.item)));
    const bad = want.no_line_for.filter((id) => used.has(id));
    checks.push({ check: `kitchen: no line for ${want.no_line_for.join(", ")}`, pass: !bad.length, detail: bad.length ? `found ${bad.join(", ")}` : undefined });
  }
  if (want.events_written !== undefined) {
    const n = end.store.events().length - end.eventsBefore;
    checks.push({ check: `kitchen: ${want.events_written} stock event(s) written`, pass: n === want.events_written, detail: `got ${n}` });
  }
  if (want.offers) {
    const wantNames = want.offers.map((n) => n.toLowerCase()).sort();
    const got = end.offers.map((o) => o.name.toLowerCase()).sort();
    checks.push({ check: `kitchen: offered ${wantNames.join(", ") || "nothing"}`, pass: JSON.stringify(got) === JSON.stringify(wantNames), detail: `got ${got.join(", ") || "nothing"}` });
  }
  if (want.catalog_unchanged)
    checks.push({ check: "kitchen: catalog unchanged", pass: JSON.stringify(catalog) === JSON.stringify(end.catalogBefore) });
  if (want.reply_numbers_from) {
    const outputs = end.calls.filter((c) => c.name === want.reply_numbers_from && !c.isError);
    const allowed = new Set(outputs.flatMap((c) => numbersIn(JSON.stringify(c.output))));
    const stray = numbersIn(end.reply).filter((n) => !allowed.has(n));
    checks.push({
      check: `kitchen: every number in the reply comes from ${want.reply_numbers_from}`,
      pass: outputs.length > 0 && !stray.length,
      detail: outputs.length ? (stray.length ? `not from the tool: ${stray.join(", ")}` : undefined) : `${want.reply_numbers_from} wasn't called`,
    });
  }
  return checks;
}
