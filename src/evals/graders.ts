import { detectLang } from "../llm/lang.js";
import type { ToolCallTrace } from "../agent/agent.js";
import type { RestaurantStore } from "../domain/restaurant.js";

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
    new_reservations?: number;
    order?: { pickupTime?: string; total?: number; items?: Record<string, number> }; // the last new order
    reservation?: { date?: string; partySize?: number; time_in?: string[] };
    no_items_with_allergen?: string;
  };
}

export interface EndState { store: RestaurantStore; ordersBefore: number; reservationsBefore: number }

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

function gradeEndState(want: NonNullable<Expectation["end_state"]>, { store, ordersBefore, reservationsBefore }: EndState): Check[] {
  const checks: Check[] = [];
  const orders = store.orders.slice(ordersBefore);
  const bookings = store.reservations.slice(reservationsBefore);
  const show = (o: unknown) => JSON.stringify(o);
  if (want.new_orders !== undefined)
    checks.push({ check: `end state: ${want.new_orders} new order(s)`, pass: orders.length === want.new_orders, detail: `got ${orders.length}: ${show(orders.map((o) => o.items.map((l) => `${l.quantity}x${l.id}`)))}` });
  if (want.new_reservations !== undefined)
    checks.push({ check: `end state: ${want.new_reservations} new reservation(s)`, pass: bookings.length === want.new_reservations, detail: `got ${bookings.length}` });
  if (want.order) {
    const o = orders.at(-1);
    const items = o && Object.fromEntries(o.items.map((l) => [l.id, l.quantity]));
    const pass = !!o
      && (want.order.pickupTime === undefined || o.pickupTime === want.order.pickupTime)
      && (want.order.total === undefined || o.total === want.order.total)
      && (want.order.items === undefined || show(Object.entries(want.order.items).sort()) === show(Object.entries(items!).sort()));
    checks.push({ check: `end state: order ${show(want.order)}`, pass, detail: o ? `got ${show({ pickupTime: o.pickupTime, total: o.total, items })}` : "no order" });
  }
  if (want.reservation) {
    const r = bookings.at(-1);
    const pass = !!r
      && (want.reservation.date === undefined || r.date === want.reservation.date)
      && (want.reservation.partySize === undefined || r.partySize === want.reservation.partySize)
      && (want.reservation.time_in === undefined || want.reservation.time_in.includes(r.time));
    checks.push({ check: `end state: reservation ${show(want.reservation)}`, pass, detail: r ? `got ${r.date} ${r.time} x${r.partySize}` : "no reservation" });
  }
  if (want.no_items_with_allergen) {
    const a = want.no_items_with_allergen;
    const bad = orders.flatMap((o) => o.items).filter((l) => store.config.menu.find((m) => m.id === l.id)?.allergens.includes(a));
    checks.push({ check: `end state: nothing ordered contains ${a}`, pass: !bad.length, detail: bad.length ? show(bad.map((l) => l.name)) : undefined });
  }
  return checks;
}
