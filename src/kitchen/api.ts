import express, { type ErrorRequestHandler } from "express";
import { validateCatalog } from "./catalog.js";
import { batchCost, maxBatch } from "./cost.js";
import { explode, type PlanResult, type PrepTask, type ShoppingLine } from "./plan.js";
import { checkLine, ProposalError, MAX_LINES, type ProposalBook } from "./proposals.js";
import { onHand, totals, type OnHand } from "./stock.js";
import { toBase, UnitError } from "./units.js";
import type { Catalog, KitchenAssistant, KitchenStore, ProductionPlan, ProposalLine, StockEvent } from "./types.js";
import type { Order } from "../domain/restaurant.js";
import type { Ledger } from "../ops/ledger.js";
import type { Limits } from "../ops/guardrails.js";
import { RateLimiter } from "../ops/guardrails.js";
import { costUsd } from "../ops/pricing.js";

export interface StockView {
  basedOn: number;
  onHand: OnHand;
  lastCount: Record<string, Record<string, { qty: number; at: string }>>;
  lastReceived: Record<string, string>;
}

/** What Today shows of a preorder: no phone, no notes, no last name. */
export interface GuestPreorder {
  firstName: string; // "" once retention has removed the name
  pickupTime: string;
  items: { name: string; quantity: number }[];
}

export interface TodayView {
  date: string; // the plan's date, or today when there's no plan ahead
  plan: ProductionPlan | null; // the first plan on or after today
  prep: (PrepTask & { recipeName: string })[];
  shopping: (ShoppingLine & { name: string })[];
  preorders: GuestPreorder[];
}

export interface KitchenApiDeps {
  store: KitchenStore;
  proposals: ProposalBook;
  assistant: KitchenAssistant;
  orders: () => readonly Order[];
  today: () => string; // YYYY-MM-DD in the kitchen's time zone
  ledger: Ledger;
  limits: Limits;
}

class BadRequest extends Error {}
class NotFound extends Error {}

const KINDS = ["items", "locations", "recipes", "plans"] as const;
type Kind = (typeof KINDS)[number];

const str = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v) throw new BadRequest(`${what} is required.`);
  return v;
};

export function stockView(events: readonly StockEvent[]): StockView {
  const lastCount: StockView["lastCount"] = {};
  const lastReceived: StockView["lastReceived"] = {};
  for (const e of events) {
    if (e.kind === "count") {
      lastCount[e.item] ??= {};
      lastCount[e.item][e.location] = { qty: e.qty, at: e.at };
    }
    if (e.kind === "receive") lastReceived[e.item] = e.at;
  }
  return { basedOn: events.length, onHand: onHand(events), lastCount, lastReceived };
}

export function kitchenRouter(deps: KitchenApiDeps) {
  const { store, proposals, assistant, ledger, limits } = deps;
  const router = express.Router();
  const limiter = new RateLimiter(limits.perMinute);
  const available = () => totals(onHand(store.events()));
  const nameOf = (c: Catalog, id: string) => c.items.find((i) => i.id === id)?.name ?? id;
  const resultWithNames = (c: Catalog, r: PlanResult) => ({
    ...r,
    prep: r.prep.map((t) => ({ ...t, recipeName: c.recipes.find((x) => x.id === t.recipe)?.name ?? t.recipe })),
    shopping: r.shopping.map((s) => ({ ...s, name: nameOf(c, s.item) })),
  });
  const plansByDate = (c: Catalog) => [...c.plans].sort((a, b) => a.date.localeCompare(b.date));
  const kindOf = (v: unknown): Kind => {
    if (!KINDS.includes(v as Kind)) throw new BadRequest(`Catalog kind must be one of ${KINDS.join(", ")}.`);
    return v as Kind;
  };

  router.get("/catalog", (_req, res) => void res.json(store.catalog()));

  const changeCatalog = (change: (c: Catalog) => Catalog, res: express.Response) => {
    const next = change(structuredClone(store.catalog()));
    const errors = validateCatalog(next);
    if (errors.length) return void res.status(422).json({ error: errors.join(" "), errors });
    store.saveCatalog(next);
    res.json(store.catalog());
  };
  router.post("/catalog/:kind", (req, res) => {
    const kind = kindOf(req.params.kind);
    const rec = req.body;
    if (typeof rec !== "object" || rec === null || Array.isArray(rec) || typeof rec.id !== "string" || !rec.id) throw new BadRequest("Send one record with an id.");
    changeCatalog((c) => {
      const list = c[kind] as { id: string }[];
      const at = list.findIndex((x) => x.id === rec.id);
      if (at >= 0) list[at] = rec; else list.push(rec);
      return c;
    }, res);
  });
  router.delete("/catalog/:kind/:id", (req, res) => {
    const kind = kindOf(req.params.kind);
    if (!(store.catalog()[kind] as { id: string }[]).some((x) => x.id === req.params.id)) throw new NotFound(`There's no ${kind.replace(/s$/, "")} called "${req.params.id}".`);
    changeCatalog((c) => {
      (c as unknown as Record<Kind, { id: string }[]>)[kind] = (c[kind] as { id: string }[]).filter((x) => x.id !== req.params.id);
      return c;
    }, res);
  });

  router.get("/stock", (_req, res) => void res.json(stockView(store.events())));
  router.get("/stock/:item/history", (req, res) => {
    const id = String(req.params.item);
    if (!store.catalog().items.some((i) => i.id === id)) throw new NotFound(`There's no item called "${id}".`);
    res.json(store.events().filter((e) => e.item === id).slice(-50).reverse());
  });

  router.post("/counts", (req, res) => {
    const { clientId, location, lines } = req.body ?? {};
    if (typeof clientId !== "string" || !/^[a-z0-9-]{8,64}$/.test(clientId)) throw new BadRequest("clientId must be 8 to 64 lowercase letters, digits or dashes.");
    str(location, "location");
    if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) throw new BadRequest(`Send between 1 and ${MAX_LINES} lines.`);
    const c = store.catalog();
    const asLines: ProposalLine[] = lines.map((l: Record<string, unknown>) => ({ kind: "count", item: l?.item as string, location, qty: l?.qty as number, unit: l?.unit as string }));
    const problems = asLines.map((l) => checkLine(c, l));
    if (problems.some(Boolean)) return void res.status(422).json({ error: problems.filter(Boolean).join(" "), problems });
    const at = new Date().toISOString();
    const events: StockEvent[] = asLines.map((l, i) => ({
      id: `count-${clientId}-${i}`, at, kind: "count", item: l.item, location, qty: toBase(c.items.find((x) => x.id === l.item)!, l.qty, l.unit), source: "manual",
    }));
    store.append(events);
    res.json({ events: events.map((e) => e.id) });
  });

  router.get("/today", (_req, res) => {
    const c = store.catalog();
    const today = deps.today();
    const plan = plansByDate(c).find((p) => p.date >= today) ?? null;
    const date = plan?.date ?? today;
    const r = resultWithNames(c, explode(c, plan?.lines ?? [], available()));
    const preorders: GuestPreorder[] = deps.orders()
      .filter((o) => o.pickupDate === date)
      .sort((a, b) => a.pickupTime.localeCompare(b.pickupTime))
      .map((o) => ({
        firstName: o.name === "[removed]" ? "" : (o.name.trim().split(/\s+/)[0] ?? ""),
        pickupTime: o.pickupTime,
        items: o.items.map((l) => ({ name: l.name, quantity: l.quantity })),
      }));
    const view: TodayView = { date, plan, prep: r.prep, shopping: r.shopping, preorders };
    res.json(view);
  });
  router.get("/plans", (_req, res) => void res.json(plansByDate(store.catalog())));
  router.get("/plans/:id/result", (req, res) => {
    const c = store.catalog();
    const plan = c.plans.find((p) => p.id === req.params.id);
    if (!plan) throw new NotFound("There's no plan with that id.");
    res.json(resultWithNames(c, explode(c, plan.lines, available())));
  });

  router.get("/cost", (req, res) => {
    const item = str(req.query.item, "item"), unit = str(req.query.unit, "unit");
    const qty = Number(str(req.query.qty, "qty"));
    if (!Number.isFinite(qty) || qty < 0) throw new BadRequest("qty must be a number.");
    res.json(batchCost(store.catalog(), store.events(), item, qty, unit));
  });
  router.get("/max-batch", (req, res) => {
    const n = maxBatch(store.catalog(), available(), str(req.query.item, "item"), str(req.query.unit, "unit"));
    res.json({ max: Number.isFinite(n) ? n : null });
  });

  router.get("/proposals", (req, res) => {
    const status = req.query.status;
    if (status !== undefined && status !== "open" && status !== "confirmed" && status !== "discarded") throw new BadRequest("status must be open, confirmed or discarded.");
    res.json(proposals.list(status).reverse());
  });
  router.get("/proposals/:id", (req, res) => {
    const p = proposals.get(req.params.id);
    if (!p) throw new ProposalError("There's no proposal with that id.", 404);
    res.json(p);
  });
  // No await before these three: confirm runs start to finish in one tick, so two requests at once can't both book.
  router.post("/proposals/:id/confirm", (req, res) => {
    const lines = req.body?.lines;
    if (lines !== undefined && !Array.isArray(lines)) throw new BadRequest("lines must be a list.");
    res.json(proposals.confirm(req.params.id, lines));
  });
  router.post("/proposals/:id/discard", (req, res) => void res.json(proposals.discard(req.params.id)));
  router.post("/proposals/:id/refresh", (req, res) => void res.json(proposals.refresh(req.params.id)));

  router.post("/assistant", async (req, res) => {
    const { sessionId, message } = req.body ?? {};
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 100 || typeof message !== "string" || !message.trim() || message.length > 2000)
      throw new BadRequest("sessionId and message (max 2000 chars) are required.");
    if (!limiter.allow("owner")) return void res.status(429).json({ error: "You're sending messages too fast. Try again in a minute." });
    if (ledger.spentToday() >= limits.dailyBudgetUsd) return void res.status(503).json({ error: "The assistant has used today's budget." });
    const t0 = Date.now();
    const reply = await assistant.turn(sessionId, message);
    ledger.logTurn({
      at: new Date().toISOString(), sessionId, channel: "kitchen", user: message, reply: reply.reply, tools: [], handoff: false,
      model: reply.model, inputTokens: reply.usage.input_tokens, outputTokens: reply.usage.output_tokens,
      costUsd: costUsd(reply.model, reply.usage), ms: Date.now() - t0,
    });
    res.json(reply);
  });

  const fail: ErrorRequestHandler = (err, _req, res, next) => {
    if (err instanceof ProposalError) return void res.status(err.status).json({ error: err.message, problems: err.problems });
    if (err instanceof UnitError) return void res.status(422).json({ error: err.message });
    if (err instanceof BadRequest) return void res.status(400).json({ error: err.message });
    if (err instanceof NotFound) return void res.status(404).json({ error: err.message });
    if (err?.type) return next(err); // body-parser errors get their own answer
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  };
  router.use(fail);
  return router;
}
