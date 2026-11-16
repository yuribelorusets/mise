import express from "express";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import type { RestaurantConfig, RestaurantStore } from "../domain/restaurant.js";
import type { Ledger } from "./ledger.js";
import type { Limits } from "./guardrails.js";
import { now } from "../config.js";

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Everything an owner needs on pop-up morning, computed from the store and the ledger. */
export function summary(config: RestaurantConfig, store: RestaurantStore, ledger: Ledger, limits: Limits) {
  const orders = [...store.orders].reverse();
  const turns = ledger.turns;
  const sessions = new Map<string, typeof turns>();
  for (const t of turns) sessions.set(t.sessionId, [...(sessions.get(t.sessionId) ?? []), t]);
  const ordered = new Set(turns.filter((t) => t.tools.some((x) => x.name === "place_order" && !x.isError)).map((t) => t.sessionId));
  const booked = new Set(turns.filter((t) => t.tools.some((x) => x.name === "create_reservation" && !x.isError)).map((t) => t.sessionId));
  const revenue = store.orders.reduce((s, o) => s + o.total, 0);
  const cost = turns.reduce((s, t) => s + t.costUsd, 0);
  const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

  return {
    restaurant: { id: config.id, name: config.name, mode: config.mode, draft: !!config.draft, accent: config.brand?.accent, popup: config.popup },
    kpis: {
      conversations: sessions.size,
      messages: turns.length,
      orders: store.orders.length,
      reservations: store.reservations.length,
      revenue,
      avgOrder: store.orders.length ? round(revenue / store.orders.length, 2) : 0,
      conversion: sessions.size ? round((ordered.size + booked.size) / sessions.size, 3) : 0,
      handoffs: turns.filter((t) => t.handoff).length,
      toolErrors: turns.reduce((s, t) => s + t.tools.filter((x) => x.isError).length, 0),
      costUsd: round(cost),
      costPerConversation: sessions.size ? round(cost / sessions.size) : 0,
      costPerOrder: store.orders.length ? round(cost / store.orders.length) : 0,
      spentTodayUsd: round(ledger.spentToday()),
      dailyBudgetUsd: limits.dailyBudgetUsd,
      avgLatencyMs: turns.length ? Math.round(turns.reduce((s, t) => s + t.ms, 0) / turns.length) : 0,
    },
    // The prep list: what to make, and how much is left to sell.
    prep: config.menu.map((m) => {
      const sold = store.orders.flatMap((o) => o.items).filter((l) => l.id === m.id).reduce((s, l) => s + l.quantity, 0);
      return { id: m.id, name: m.name, sold, batch: m.quantity ?? null, remaining: store.remaining(m.id) ?? null };
    }),
    windows: store.windows(now()).map((w) => ({
      ...w,
      orders: store.orders.filter((o) => o.pickupTime === w.time).map((o) => ({ id: o.id, name: o.name, items: o.items.map((l) => `${l.quantity}× ${l.name}`).join(", ") })),
    })),
    orders,
    reservations: [...store.reservations].reverse(),
    handoffs: turns.filter((t) => t.handoff).reverse().slice(0, 50),
    conversations: [...sessions.entries()].reverse().slice(0, 30).map(([id, ts]) => ({
      id, channel: ts[0].channel, started: ts[0].at, ordered: ordered.has(id), handoff: ts.some((t) => t.handoff),
      costUsd: round(ts.reduce((s, t) => s + t.costUsd, 0)),
      turns: ts.map(({ user, reply, tools }) => ({ user, reply, tools: tools.map((x) => x.name + (x.isError ? "!" : "")) })),
    })),
  };
}

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  // Quote, and defuse spreadsheet formulas (a guest named "=HYPERLINK(...)").
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

export function ordersCsv(store: RestaurantStore) {
  const rows = [["code", "created", "pickup_date", "pickup_time", "name", "phone", "items", "total", "notes"]];
  for (const o of store.orders)
    rows.push([o.id, o.createdAt ?? "", o.pickupDate ?? "", o.pickupTime, o.name, o.phone, o.items.map((l) => `${l.quantity}x ${l.name}`).join("; "), String(o.total), o.notes ?? ""]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/**
 * Owner dashboard at /admin. Protected by ADMIN_TOKEN (sent as a Bearer token, or
 * ?token= for the CSV link). Disabled entirely when no token is configured.
 */
export function adminRouter(d: { config: RestaurantConfig; store: RestaurantStore; ledger: Ledger; limits: Limits; publicDir: string }) {
  const r = express.Router();
  r.get("/", (_req, res) => res.sendFile(join(d.publicDir, "admin.html")));

  r.use("/api", (req, res, next) => {
    const token = process.env.ADMIN_TOKEN;
    if (!token) return res.status(503).json({ error: "Set ADMIN_TOKEN to enable the dashboard." });
    const given = req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? String(req.query.token ?? "");
    if (!safeEqual(given, token)) return res.status(401).json({ error: "Wrong token." });
    res.setHeader("cache-control", "no-store");
    next();
  });
  r.get("/api/summary", (_req, res) => res.json(summary(d.config, d.store, d.ledger, d.limits)));
  r.get("/api/orders.csv", (_req, res) => {
    res.type("text/csv").attachment(`${d.config.id}-orders.csv`).send(ordersCsv(d.store));
  });
  return r;
}
