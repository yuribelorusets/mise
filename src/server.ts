import express from "express";
import type { LLM } from "./llm/types.js";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { loadRestaurant, localDate, RestaurantStore, type MenuItem, type Order, type RestaurantConfig } from "./domain/restaurant.js";
import { WebhookClient } from "./integrations/webhook.js";
import { runTurn, type Session } from "./agent/agent.js";
import { makeLLM, now } from "./config.js";
import { Ledger, retainDays, scheduleCompaction } from "./ops/ledger.js";
import { costUsd } from "./ops/pricing.js";
import { RateLimiter, limitsFromEnv, type Limits } from "./ops/guardrails.js";
import { adminRouter } from "./ops/admin.js";
import { jsonOnly, sameOrigin } from "./ops/request-guards.js";
import { extname, join } from "node:path";
import { kitchenRouter } from "./kitchen/api.js";
import { ProposalBook } from "./kitchen/proposals.js";
import { createKitchenAssistant } from "./kitchen/assistant/index.js";
import { ownerAuth } from "./ops/owner-auth.js";
import { FileStore } from "./kitchen/file-store.js";
import { MemoryStore } from "./kitchen/memory-store.js";
import { toBase } from "./kitchen/units.js";
import { orderCapacity, planLines } from "./kitchen/preorders.js";
import { onHand, totals } from "./kitchen/stock.js";
import type { Catalog, KitchenStore } from "./kitchen/types.js";

export interface AppOptions {
  config?: RestaurantConfig;
  llm?: LLM;
  store?: RestaurantStore;
  webhook?: WebhookClient;
  ledger?: Ledger;
  limits?: Partial<Limits>;
  kitchen?: KitchenStore;
  /** For tests: a proposal book the test can create proposals in. */
  proposals?: ProposalBook;
  /** Signs the owner in to /api/kitchen. Without one (here or in MISE_OWNER_PASSCODE) sign-in answers 503. */
  ownerPasscode?: string;
  secureCookies?: boolean;
  /** For tests: serve the built app from here instead of web/dist. */
  webDist?: string;
}

/** The kitchen's stock and catalog: on disk under DATA_DIR, else in memory, seeded from data/kitchens/<id>.json. */
function kitchenStore(id: string): KitchenStore {
  const seed: Catalog = JSON.parse(readFileSync(fileURLToPath(new URL(`../data/kitchens/${id}.json`, import.meta.url)), "utf8"));
  if (process.env.DATA_DIR) return new FileStore(process.env.DATA_DIR, id, seed);
  console.warn("DATA_DIR isn't set, so kitchen stock isn't saved between restarts.");
  return new MemoryStore(seed);
}

/** A menu item that names a kitchen item must name a real one, in a unit that converts. A config mistake stops the server here. */
function checkMakes(config: RestaurantConfig, catalog: Catalog) {
  for (const m of config.menu) {
    if (!m.makes) continue;
    const item = catalog.items.find((i) => i.id === m.makes!.item);
    if (!item) throw new Error(`Menu item "${m.id}" makes "${m.makes.item}", which isn't in the kitchen catalog.`);
    try {
      toBase(item, 1, m.makes.unit);
    } catch {
      throw new Error(`Menu item "${m.id}" makes "${m.makes.item}" in "${m.makes.unit}", which isn't a unit that item has.`);
    }
  }
}

/** How many more orders the kitchen can make of a menu item. Nothing is computed unless the pop-up sells from stock. */
function kitchenCapacity(config: RestaurantConfig, kitchen: KitchenStore, orders: () => readonly Order[]) {
  let logged = false;
  return (m: MenuItem): number | undefined => {
    if (!m.makes || config.popup.sellFromStock !== true) return undefined;
    try {
      const c = kitchen.catalog();
      const plan = c.plans.find((p) => p.date === config.popup.eventDate);
      const planned = planLines(plan, config.popup.eventDate, orders(), config.menu);
      return orderCapacity(c, totals(onHand(kitchen.events())), planned, m.makes);
    } catch (err) {
      // A catalog edit can remove what the menu item makes. Don't take the menu down: sell on the menu quantity alone.
      if (!logged) console.error(`Can't work out what "${m.id}" can be made from stock, so only its menu quantity limits it:`, err);
      logged = true;
      return undefined;
    }
  };
}

const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
/** The React app once it's built; the old static pages until then. */
export const staticDir = (exists: (p: string) => boolean = existsSync) => (exists(WEB_DIST) ? WEB_DIST : PUBLIC_DIR);

const MAX_SESSIONS = 2000;
const SESSION_IDLE_MS = 3 * 60 * 60_000; // forget a conversation after 3 idle hours (it's still in the ledger)

export function createApp(opts: AppOptions = {}) {
  const config = opts.config ?? opts.store?.config ?? loadRestaurant();
  const ledger = opts.ledger ?? new Ledger(process.env.DATA_DIR, config.id);
  const webhook = opts.webhook ?? new WebhookClient();
  const days = retainDays();
  const kitchen = opts.kitchen ?? kitchenStore(config.id);
  checkMakes(config, kitchen.catalog());
  const capacity = kitchenCapacity(config, kitchen, () => store.orders);
  const store: RestaurantStore = opts.store ?? new RestaurantStore(config, { history: ledger, recorder: ledger, capacity });
  if (ledger.persistent) {
    const compactAll = () => {
      ledger.compact(new Date(), days);
      store.adoptRedacted(ledger.orders);
      webhook.compact(new Date(), days);
    };
    compactAll();
    scheduleCompaction(compactAll);
  }
  const llm = opts.llm ?? makeLLM(undefined, undefined, config);
  const limits = { ...limitsFromEnv(), ...opts.limits };
  const limiter = new RateLimiter(limits.perMinute);
  if (config.draft) console.warn(`⚠ ${config.id} is marked draft: check menu, prices and dates in data/restaurants/${config.id}.json before sharing the link.`);

  const sessions = new Map<string, Session & { lastSeen: number; lock: Promise<unknown> }>();
  const session = (id: string) => {
    const now = Date.now();
    let s = sessions.get(id);
    if (!s) {
      if (sessions.size >= MAX_SESSIONS) {
        for (const [k, v] of sessions) if (now - v.lastSeen > SESSION_IDLE_MS) sessions.delete(k);
        if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      }
      sessions.set(id, (s = { id, messages: [], lastSeen: now, lock: Promise.resolve() }));
    }
    s.lastSeen = now;
    return s;
  };
  /** One turn at a time per conversation: two messages at once (a double-click, two tabs) would interleave the history. */
  const serialized = <T>(s: { lock: Promise<unknown> }, fn: () => Promise<T>): Promise<T> => {
    const run = s.lock.then(fn, fn);
    s.lock = run.catch(() => undefined);
    return run;
  };
  const userTurns = (s: Session) => s.messages.filter((m) => m.role === "user" && typeof m.content === "string").length;
  const contact = config.instagram ? `message us on Instagram (${config.instagram})` : config.phone ? `call us at ${config.phone}` : "contact us directly";

  /** Runs a turn with the guardrails, and logs it with its cost. */
  async function guardedTurn(s: Session, text: string, channel: "chat") {
    const t0 = Date.now();
    let turn;
    if (userTurns(s) >= limits.turnsPerSession) {
      turn = { reply: `This conversation has gotten long. To finish up, please ${contact}.`, toolCalls: [], handoff: true, llmCalls: 0, usage: { input_tokens: 0, output_tokens: 0 }, limited: "turns" as const };
    } else if (ledger.spentToday() >= limits.dailyBudgetUsd) {
      turn = { reply: `Our assistant is taking a break for today. Please ${contact} and we'll help you there.`, toolCalls: [], handoff: true, llmCalls: 0, usage: { input_tokens: 0, output_tokens: 0 }, limited: "budget" as const };
    } else {
      turn = await runTurn(llm, s, text, { store, webhook, channel, now: now() });
    }
    ledger.logTurn({
      at: new Date().toISOString(), sessionId: s.id, channel, user: text, reply: turn.reply,
      tools: turn.toolCalls.map((c) => ({ name: c.name, isError: c.isError })), handoff: turn.handoff,
      model: llm.name, inputTokens: turn.usage.input_tokens, outputTokens: turn.usage.output_tokens,
      costUsd: costUsd(llm.name, turn.usage), ms: Date.now() - t0,
      ...("degraded" in turn && turn.degraded ? { degraded: true } : {}),
      ...("flags" in turn && turn.flags?.length ? { flags: turn.flags } : {}),
    });
    return turn;
  }

  const app = express();
  app.set("trust proxy", 1); // behind Render/Fly/Cloudflare: use the real client IP for rate limits
  app.use(sameOrigin((process.env.MISE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)));
  app.use(jsonOnly);
  app.use(express.json({ limit: "20kb" }));
  const owner = ownerAuth({ passcode: opts.ownerPasscode ?? process.env.MISE_OWNER_PASSCODE, secure: opts.secureCookies ?? process.env.NODE_ENV === "production" });
  app.use(owner.router);
  const dir = opts.webDist ?? staticDir();
  app.use(express.static(dir));

  // Malformed or oversized bodies: a clean 4xx, never a stack trace.
  app.use(((err, _req, res, next) => {
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed JSON." });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "Request too large." });
    next(err);
  }) as express.ErrorRequestHandler);

  app.get("/api/health", (_req, res) => res.json({ ok: true, llm: llm.name, restaurant: config.id, persistent: ledger.persistent }));

  // What the chat page needs to brand itself. Public, so nothing secret here.
  app.get("/api/config", (_req, res) =>
    res.json({
      id: config.id, name: config.name, city: config.city, instagram: config.instagram,
      tagline: config.brand?.tagline, accent: config.brand?.accent, examples: config.brand?.examples ?? [],
      popup: { eventDate: config.popup.eventDate, location: config.popup.location, pickupWindows: config.popup.pickupWindows },
      llm: llm.name, draft: !!config.draft,
      menu: config.menu.map(({ id, name, category, price, description, allergens, dietary }) => ({ id, name, category, price, description, allergens, dietary })),
      privacyNotice: `We keep your name, phone number, order notes and what you write in this chat for ${days} days, then delete them. The owner can read them, to prepare your order and to improve the assistant.`,
    }),
  );

  // Web chat
  app.post("/api/chat", async (req, res) => {
    const { sessionId, message } = req.body ?? {};
    if (typeof sessionId !== "string" || sessionId.length > 100 || typeof message !== "string" || !message.trim() || message.length > 2000)
      return res.status(400).json({ error: "sessionId and message (max 2000 chars) are required" });
    if (!limiter.allow(req.ip ?? "unknown")) return res.status(429).json({ error: "You're sending messages too fast. Try again in a minute." });
    try {
      const s = session(sessionId);
      res.json(await serialized(s, () => guardedTurn(s, message, "chat")));
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: "The model is unavailable right now." });
    }
  });

  const proposals = opts.proposals ?? new ProposalBook(kitchen, { file: process.env.DATA_DIR ? join(process.env.DATA_DIR, `${config.id}.proposals.json`) : undefined });
  const assistant = createKitchenAssistant({ store: kitchen, proposals, llm, now });
  app.use("/api/kitchen", owner.requireOwner, kitchenRouter({ store: kitchen, proposals, assistant, orders: () => store.orders, menu: config.menu, today: () => localDate(now(), config.timezone), ledger, limits }));

  app.use("/admin", adminRouter({ config, store, ledger, limits, publicDir: PUBLIC_DIR }));

  // The app routes itself in the browser, so /count or /stock/eggs on a reload gets index.html. Only for pages: a missing script stays a 404.
  if (dir !== PUBLIC_DIR) {
    app.use((req, res, next) => {
      if (req.method !== "GET" || /^\/(api|admin)(\/|$)/.test(req.path) || extname(req.path) || !req.accepts("html")) return next();
      res.set("Cache-Control", "no-cache").sendFile(join(dir, "index.html"));
    });
  }

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  const app = createApp();
  app.listen(port, () => console.log(`Mise listening on http://localhost:${port}`));
}
