# Wave 2: kitchen API, assistant, wired screens, preorders in the plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to work through this task by task. Steps use checkboxes (`- [ ]`).

**Goal:** Put the kitchen core behind a signed-in API, give the owner an assistant that only ever proposes stock changes, replace the screen fixtures with live data, and let preorders feed the production plan and sell against what the kitchen can actually make.

**Architecture:** Package D adds the owner sign-in, the request guards and `/api/kitchen/*`, with the proposal lifecycle in `src/kitchen/proposals.ts`. Package E adds the kitchen assistant in `src/kitchen/assistant/`, its own tool loop and mock, and kitchen eval scenarios. Package F swaps the fixtures in `web/src/pages/*` for TanStack Query hooks. Package G turns preorders into plan lines and replaces the menu's fixed `quantity` with max batch.

**Tech stack:** TypeScript, Express 5, vitest, fast-check (D, E, G). React, React Router, TanStack Query 5, Vitest and Testing Library (F).

**Spec:** [docs/design/kitchen-v1.md](../design/kitchen-v1.md) · **Master plan:** [kitchen-v1.md](kitchen-v1.md) · **Built on:** `main` at `097bb08`

## Global constraints

The master plan's constraints apply. In addition:
- Step 0 below lands on `main` before D and E start. After that, `src/kitchen/types.ts` is read-only again until the wave ends.
- D and E run in parallel. F starts once D is merged. G starts once D, E and F are merged. Each package edits only the files under its "Owns" line. D and E share no files; F and E share no files, so F can start while E is still open.
- `docs/security-backlog.md` is the orchestrator's. When a package fixes a backlog entry it says so in its report, flips the matching `it.fails` to `it` if there is one, and the orchestrator moves the entry out of "Open" when it merges.
- Never run evals except with `--llm mock`. Local Node is 20, so if vitest prints a `Map.groupBy` crash on a failure, rerun with `--reporter=tap-flat` to read it.
- JSON can't hold `Infinity`. Anywhere the API or a tool returns a max batch, `null` means "not limited by stock".
- Owner-facing names: say "item", "location", "count", "proposal", "book" (the card's word for confirm). Guests never see the word "proposal".

Backlog entries this wave closes: the `/api` form-POST and Origin medium (D1), the index fallback (D5), the privacy notice (D5), the `Object.prototype` ids medium (E1), the repeated-event replay low (E1), the Today fixtures low (F), and the `maxBatch` cap low (G1). The others stay open, including the turn-cap medium in `src/server.ts` and the admin token rate limit: the admin dashboard keeps its token this wave.

## Step 0: shared interfaces (orchestrator, on `main`)

D builds the proposal lifecycle and the routes; E's write tools create proposals and the eval grader reads them. Both need the same `ProposalBook` and reply shapes before either starts, so the orchestrator commits them first, the way wave 0 committed `types.ts`.

**Files:** `src/kitchen/types.ts`, `src/kitchen/proposals.ts` (new), `src/kitchen/assistant/index.ts` (new), `src/kitchen/memory-store.ts`, `test/security-backlog.test.ts`, `test/web-fixtures.test.ts` (new), `test/kitchen/proposals.test.ts` (new).

- [ ] **Step 1: Add to `src/kitchen/types.ts`**

```ts
// In Proposal, after basedOn:
  confirmedAt?: string;
  discardedAt?: string;
  /** Ids of the stock events the confirm wrote. */
  events?: string[];

/** A proposal as the API and the assistant return it. `stale` and `problems` are worked out when it's read. */
export interface ProposalView extends Proposal {
  /** Stock for one of its items changed after it was made. It can't be booked until it's refreshed. */
  stale: boolean;
  /** One entry per line: why it can't be booked as it stands, or null. */
  problems: (string | null)[];
}

export interface ConfirmResult {
  proposal: ProposalView;
  events: string[];
}

/** The assistant met a name it doesn't know and offers to add it. Nothing is written until the owner says yes. */
export interface NewItemOffer {
  name: string;
  baseUnit: BaseUnit;
  raw?: string;
}

export interface AssistantReply {
  reply: string;
  proposals: ProposalView[];
  offers: NewItemOffer[];
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface KitchenAssistant {
  turn(sessionId: string, text: string): Promise<AssistantReply>;
}
```

- [ ] **Step 2: Create `src/kitchen/proposals.ts`** with the line check and the create/read half of the book. D owns this file from here on and adds confirm, discard, refresh, stale and saving to disk without changing these signatures.

```ts
import { randomUUID } from "node:crypto";
import { toBase } from "./units.js";
import type { Catalog, KitchenStore, Proposal, ProposalLine, ProposalView, StockSource } from "./types.js";

export class ProposalError extends Error {
  constructor(message: string, readonly status = 422, readonly problems: (string | null)[] = []) {
    super(message);
  }
}

const KINDS = ["receive", "use", "waste", "count", "move"];
export const MAX_LINES = 50;

/** Why a line can't be booked against this catalog, or null when it can. The same check runs on create, refresh and confirm. */
export function checkLine(c: Catalog, l: ProposalLine): string | null {
  if (typeof l !== "object" || l === null) return "That line is empty.";
  const item = c.items.find((i) => i.id === l.item);
  if (!item) return `"${String(l.item)}" isn't an item yet.`;
  if (!KINDS.includes(l.kind)) return `"${String(l.kind)}" isn't a kind of stock change.`;
  if (!c.locations.some((x) => x.id === l.location)) return `"${String(l.location)}" isn't a storage location.`;
  if (l.kind === "move" && (l.to === l.location || !c.locations.some((x) => x.id === l.to))) return `Moving ${item.name} needs a different location to go to.`;
  if (l.kind !== "move" && l.to !== undefined) return `Only a move has a location to go to.`;
  if (l.unitCost !== undefined && !(typeof l.unitCost === "number" && Number.isFinite(l.unitCost) && l.unitCost >= 0)) return `${String(l.unitCost)} isn't a price.`;
  if (typeof l.unit !== "string" || typeof l.qty !== "number") return `${item.name} needs an amount and a unit.`;
  try {
    toBase(item, l.qty, l.unit);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

/** Keeps only the fields a line has, so a model can't smuggle extra ones into the record. */
export const cleanLine = (l: ProposalLine): ProposalLine => ({
  kind: l.kind, item: l.item, location: l.location, qty: l.qty, unit: l.unit,
  ...(l.to !== undefined ? { to: l.to } : {}),
  ...(l.unitCost !== undefined ? { unitCost: l.unitCost } : {}),
  ...(typeof l.raw === "string" && l.raw.trim() ? { raw: l.raw.trim().slice(0, 200) } : {}),
});

export interface ProposalBookOptions {
  /** Where to keep proposals between restarts. Without it they live in memory. */
  file?: string;
  now?: () => Date;
}

export class ProposalBook {
  protected all = new Map<string, Proposal>();
  protected now: () => Date;

  constructor(protected store: KitchenStore, protected opts: ProposalBookOptions = {}) {
    this.now = opts.now ?? (() => new Date());
  }

  create(input: { source: StockSource; lines: ProposalLine[] }): ProposalView {
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > MAX_LINES)
      throw new ProposalError(`A proposal needs between 1 and ${MAX_LINES} lines.`);
    const c = this.store.catalog();
    const problems = input.lines.map((l) => checkLine(c, l));
    if (problems.some(Boolean)) throw new ProposalError(problems.filter(Boolean).join(" "), 422, problems);
    const p: Proposal = {
      id: `p-${randomUUID().slice(0, 8)}`,
      createdAt: this.now().toISOString(),
      source: input.source,
      lines: input.lines.map(cleanLine),
      status: "open",
      basedOn: this.store.events().length,
    };
    this.all.set(p.id, p);
    return this.view(p);
  }

  get(id: string): ProposalView | undefined {
    const p = this.all.get(id);
    return p && this.view(p);
  }

  list(status?: Proposal["status"]): ProposalView[] {
    return [...this.all.values()].filter((p) => !status || p.status === status).map((p) => this.view(p));
  }

  protected view(p: Proposal): ProposalView {
    return { ...structuredClone(p), stale: false, problems: p.lines.map(() => null) };
  }
}
```

- [ ] **Step 3: Create `src/kitchen/assistant/index.ts`**, a stub D can mount and E replaces:

```ts
import type { LLM } from "../../llm/types.js";
import type { ProposalBook } from "../proposals.js";
import type { KitchenAssistant, KitchenStore } from "../types.js";

export interface AssistantDeps {
  store: KitchenStore;
  proposals: ProposalBook;
  llm: LLM;
  now?: () => Date;
}

export function createKitchenAssistant(deps: AssistantDeps): KitchenAssistant {
  return {
    async turn() {
      return { reply: "The kitchen assistant isn't built yet.", proposals: [], offers: [], model: deps.llm.name, usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
}
```

- [ ] **Step 4: `MemoryStore.append` skips ids it already has**, as `FileStore.append` does. Confirming twice relies on this in every test that uses the memory store.

```ts
append(events: StockEvent[]) {
  const seen = new Set(this.log.map((e) => e.id));
  for (const e of events) if (!seen.has(e.id)) { seen.add(e.id); this.log.push({ ...e }); }
}
```

- [ ] **Step 5:** Move the `describe("web fixtures against the kitchen core")` block, its `prepTasks` import and the `rukiKitchen` it needs, from `test/security-backlog.test.ts` into a new `test/web-fixtures.test.ts`, unchanged. F owns that file, and E owns the rest of `test/security-backlog.test.ts`.
- [ ] **Step 6:** `test/kitchen/proposals.test.ts` with three tests: `create` refuses a line for an unknown item with a 422 and a per-line problem; it keeps `basedOn` at the event count; it drops a field that isn't part of a line (`{ ...line, evil: 1 }`). And one test that `MemoryStore.append` called twice with the same event leaves one.
- [ ] **Step 7:** `npm run typecheck && npm test`. Commit: `Add the shared proposal and assistant interfaces for wave 2`

---

## Package D: kitchen API and owner sign-in

**Branch:** `feat/kitchen-api` · **Agent:** builder · **Owns:** `src/server.ts`, `src/ops/request-guards.ts` (new), `src/ops/owner-auth.ts` (new), `src/kitchen/proposals.ts`, `src/kitchen/api.ts` (new), `test/request-guards.test.ts` (new), `test/owner-auth.test.ts` (new), `test/kitchen/proposals.test.ts`, `test/kitchen/api.test.ts` (new), `test/server.test.ts`

**Consumes:** step 0's `ProposalBook`, `ProposalError`, `checkLine`, `cleanLine`, `MAX_LINES`, `createKitchenAssistant`, `ProposalView`, `ConfirmResult`, `AssistantReply`, `KitchenAssistant`. From wave 1: `FileStore`, `MemoryStore`, `validateCatalog`, `itemById`, `toBase`, `factor`, `UnitError`, `onHand`, `totals`, `explode`, `batchCost`, `maxBatch`, `RateLimiter`, `localDate`, `Order`.

**Produces** (F and G use these exact names):
- `createApp` options `kitchen?: KitchenStore`, `ownerPasscode?: string`, `secureCookies?: boolean`
- `src/ops/request-guards.ts`: `jsonOnly`, `sameOrigin(allowed: string[])`
- `src/ops/owner-auth.ts`: `OWNER_COOKIE = "mise_owner"`, `class Passcode`, `class FailedSignIns`, `ownerAuth(opts): { router, requireOwner }`
- `src/kitchen/proposals.ts`: `ProposalBook` gains `confirm(id, edits?)`, `discard(id)`, `refresh(id)` and saving to `opts.file`
- `src/kitchen/api.ts`: `kitchenRouter(deps: KitchenApiDeps)`, `interface TodayView`, `interface StockView`, `interface GuestPreorder`
- the routes in the table under D4, the `menu` and new `privacyNotice` in `/api/config`, and the index fallback

### Task D1: JSON only, and no cross-site writes

This is the backlog's medium prerequisite for a session cookie. Today `express.urlencoded` means a hostile page can send a plain form POST to any `/api` route. Once owner routes sit behind a cookie that's a forged request, so it goes first.

**Files:** Create `src/ops/request-guards.ts`. Modify `src/server.ts`. Test: `test/request-guards.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";

let server: Server;
let base = "";
beforeAll(async () => {
  process.env.MISE_TODAY = "2026-12-04";
  const app = createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1000 } });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => server.close());

const chat = (headers: Record<string, string>, body = JSON.stringify({ sessionId: "g", message: "hi" })) =>
  fetch(`${base}/api/chat`, { method: "POST", headers, body });

describe("request guards", () => {
  it("refuses a form-encoded POST with 415", async () => {
    const res = await chat({ "content-type": "application/x-www-form-urlencoded" }, "sessionId=g&message=hi");
    expect(res.status).toBe(415);
  });
  it("refuses a POST with no content type", async () => {
    expect((await chat({})).status).toBe(415);
  });
  it("takes JSON with a charset", async () => {
    expect((await chat({ "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  });
  it("refuses a write from another site", async () => {
    expect((await chat({ "content-type": "application/json", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await chat({ "content-type": "application/json", origin: "https://evil.example" })).status).toBe(403);
  });
  it("takes a write from the same origin", async () => {
    expect((await chat({ "content-type": "application/json", "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await chat({ "content-type": "application/json", origin: base })).status).toBe(200);
  });
  it("leaves clients that send neither header alone", async () => {
    // curl, the load test and server-to-server calls aren't browsers, so they can't be tricked into a forged request.
    expect((await chat({ "content-type": "application/json" })).status).toBe(200);
  });
  it("doesn't guard reads", async () => {
    expect((await fetch(`${base}/api/config`, { headers: { "sec-fetch-site": "cross-site" } })).status).toBe(200);
  });
});
```

- [ ] **Step 2:** `npx vitest run test/request-guards.test.ts`. Expected: FAIL, the form POST gets 400 and the cross-site writes get 200.
- [ ] **Step 3: Implement** `src/ops/request-guards.ts`

```ts
import type { RequestHandler } from "express";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * `/api` writes must be JSON. A browser only sends JSON cross-site after a CORS preflight, which we never answer,
 * so this alone stops a plain HTML form from posting here. `req.is()` returns null for a request with no body,
 * so read the header.
 */
export const jsonOnly: RequestHandler = (req, res, next) => {
  if (!WRITES.has(req.method) || !req.path.startsWith("/api/")) return next();
  const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return res.status(415).json({ error: "Send the request as JSON." });
  next();
};

/** Writes from a browser must come from our own pages. `Sec-Fetch-Site` first (every current browser sends it), then `Origin`. */
export function sameOrigin(allowed: string[] = []): RequestHandler {
  return (req, res, next) => {
    if (!WRITES.has(req.method)) return next();
    const site = req.get("sec-fetch-site");
    if (site) return site === "same-origin" || site === "none" ? next() : refuse(res);
    const origin = req.get("origin");
    if (!origin) return next();
    return origin === `${req.protocol}://${req.get("host")}` || allowed.includes(origin) ? next() : refuse(res);
  };
}

const refuse = (res: Parameters<RequestHandler>[1]) => res.status(403).json({ error: "That request came from another site." });
```

- [ ] **Step 4:** In `src/server.ts`, delete the `express.urlencoded` line. Mount, before `express.json`:

```ts
app.use(sameOrigin((process.env.MISE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)));
app.use(jsonOnly);
```

  `npm run web:dev` still works: the page and its `/api` calls are both on the Vite port, so the browser sends `Sec-Fetch-Site: same-origin`, and Vite's proxy keeps the `Host` header by default.
- [ ] **Step 5:** `npm test`. Expected: PASS, including `test/server.test.ts`, the load test's requests (JSON, no `Origin`) and the admin views (GET only). Run `npm run loadtest -- 300 50` too.
- [ ] **Step 6:** Commit: `Accept only JSON on /api writes and refuse cross-site ones`

### Task D2: Owner sign-in

A passcode from `MISE_OWNER_PASSCODE`, hashed at startup and compared in constant time, sets an HttpOnly session cookie. The guest routes stay public.

Choices, so the builder doesn't have to make them:
- **Hashing.** `scryptSync(passcode, salt, 32)` with a random 16-byte salt made at startup. A sign-in hashes what was typed with the same salt and compares with `timingSafeEqual`. Both buffers are always 32 bytes, so the comparison doesn't leak the length. The plain passcode isn't kept after the constructor. Fewer than 8 characters refuses to start owner sign-in (the routes answer 503 with a message saying why).
- **Sessions.** A random 32-byte token, base64url. The server keeps `sha256(token)` and an expiry in a `Map`, so a heap dump doesn't hold live tokens. 30 days, at most 50 sessions (the oldest goes first). A restart signs everyone out, which is fine for one owner.
- **Cookie.** `mise_owner=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`, plus `Secure` when `secureCookies` is set or `NODE_ENV=production`. `Strict` costs nothing here: the cookie is only needed by `fetch` calls from our own pages, never on the first navigation from a link.
- **Rate limit.** Failed sign-ins only: 5 per IP per 15 minutes, and 50 overall per 15 minutes for someone rotating IPs. Over the limit is 429 with `Retry-After`, checked before the passcode is hashed, so a blocked guess costs nothing and learns nothing. A success clears that IP's count.
- **Routes.** `POST /api/owner/sign-in { passcode }` → 204 and the cookie. `POST /api/owner/sign-out` → 204, deletes the session and expires the cookie. `GET /api/owner/me` → `{ owner: true }` or 401. Everything under `/api/kitchen` answers 401 `{ error: "Sign in first." }` without a session.
- No new dependencies. The cookie header is parsed by hand.

**Files:** Create `src/ops/owner-auth.ts`. Modify `src/server.ts`. Test: `test/owner-auth.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/server.js";
import { MockLLM } from "../src/llm/mock.js";
import { WebhookClient } from "../src/integrations/webhook.js";
import { FailedSignIns, Passcode } from "../src/ops/owner-auth.js";

async function start(opts: Parameters<typeof createApp>[0] = {}) {
  const app = createApp({ llm: new MockLLM(), webhook: new WebhookClient({ url: "", fallbackFile: null }), limits: { perMinute: 1000 }, ownerPasscode: "syrniki-2026", ...opts });
  const s = await new Promise<Server>((r) => { const x = app.listen(0, () => r(x)); });
  const a = s.address();
  return { url: `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`, close: () => s.close() };
}
const json = { "content-type": "application/json" };
const signIn = (url: string, passcode: string, ip = "1.1.1.1") =>
  fetch(`${url}/api/owner/sign-in`, { method: "POST", headers: { ...json, "x-forwarded-for": ip }, body: JSON.stringify({ passcode }) });
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

describe("owner sign-in", () => {
  it("compares passcodes without keeping the plain one", () => {
    const p = new Passcode("syrniki-2026");
    expect(p.matches("syrniki-2026")).toBe(true);
    expect(p.matches("syrniki-2027")).toBe(false);
    expect(p.matches(42)).toBe(false);
    expect(JSON.stringify(p)).not.toContain("syrniki");
    expect(() => new Passcode("short")).toThrow(/8/);
  });

  it("sets an HttpOnly, SameSite=Strict cookie, Secure in production", async () => {
    const dev = await start();
    const res = await signIn(dev.url, "syrniki-2026");
    expect(res.status).toBe(204);
    const c = res.headers.get("set-cookie") ?? "";
    expect(c).toMatch(/^mise_owner=[A-Za-z0-9_-]{43};/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).not.toMatch(/Secure/i);
    dev.close();
    const prod = await start({ secureCookies: true });
    expect((await signIn(prod.url, "syrniki-2026")).headers.get("set-cookie")).toMatch(/Secure/i);
    prod.close();
  });

  it("answers 401 on kitchen routes without a session, and lets the owner in with one", async () => {
    const s = await start();
    expect((await fetch(`${s.url}/api/kitchen/catalog`)).status).toBe(401);
    expect((await fetch(`${s.url}/api/kitchen/catalog`, { headers: { cookie: "mise_owner=made-up" } })).status).toBe(401);
    const cookie = cookieOf(await signIn(s.url, "syrniki-2026"));
    expect((await fetch(`${s.url}/api/kitchen/catalog`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${s.url}/api/owner/me`, { headers: { cookie } })).status).toBe(200);
    await fetch(`${s.url}/api/owner/sign-out`, { method: "POST", headers: { ...json, cookie }, body: "{}" });
    expect((await fetch(`${s.url}/api/kitchen/catalog`, { headers: { cookie } })).status).toBe(401);
    s.close();
  });

  it("keeps the guest routes public", async () => {
    const s = await start();
    expect((await fetch(`${s.url}/api/config`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
    const res = await fetch(`${s.url}/api/chat`, { method: "POST", headers: json, body: JSON.stringify({ sessionId: "g", message: "hi" }) });
    expect(res.status).toBe(200);
    s.close();
  });

  it("slows down guessing after 5 wrong passcodes from one IP", async () => {
    const s = await start();
    for (let i = 0; i < 5; i++) expect((await signIn(s.url, `guess-${i}-xxxx`)).status).toBe(401);
    const blocked = await signIn(s.url, "syrniki-2026");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await signIn(s.url, "syrniki-2026", "2.2.2.2")).status).toBe(204);
    s.close();
  });

  it("forgets failures after the window, and caps them overall", () => {
    const f = new FailedSignIns({ perIp: 5, overall: 50, windowMs: 15 * 60_000 });
    for (let i = 0; i < 5; i++) f.fail("a", 0);
    expect(f.retryAfter("a", 1000)).toBeGreaterThan(0);
    expect(f.retryAfter("a", 15 * 60_000 + 1)).toBe(0);
    for (let i = 0; i < 50; i++) f.fail(`ip-${i}`, 0);
    expect(f.retryAfter("fresh", 1000)).toBeGreaterThan(0);
  });

  it("answers 503 when no passcode is set", async () => {
    const s = await start({ ownerPasscode: "" });
    expect((await signIn(s.url, "anything-at-all")).status).toBe(503);
    expect((await fetch(`${s.url}/api/kitchen/catalog`)).status).toBe(401);
    s.close();
  });
});
```

  The tests pass `x-forwarded-for`, which `trust proxy` (already 1) turns into `req.ip`. The `/api/kitchen/catalog` route arrives in D4; until then mount a placeholder `GET /api/kitchen/catalog` behind `requireOwner` that returns the catalog from `opts.kitchen`, and D4 replaces it.
- [ ] **Step 2:** `npx vitest run test/owner-auth.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `src/ops/owner-auth.ts`

```ts
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import express, { type RequestHandler } from "express";

export const OWNER_COOKIE = "mise_owner";
const SESSION_MS = 30 * 24 * 60 * 60_000;
const MAX_SESSIONS = 50;

export class Passcode {
  readonly #salt = randomBytes(16);
  readonly #want: Buffer;
  constructor(passcode: string) {
    if (passcode.length < 8) throw new Error("MISE_OWNER_PASSCODE needs at least 8 characters.");
    this.#want = scryptSync(passcode, this.#salt, 32);
  }
  matches(given: unknown): boolean {
    if (typeof given !== "string" || given.length > 200) return false;
    return timingSafeEqual(scryptSync(given, this.#salt, 32), this.#want);
  }
}

export class FailedSignIns {
  private byIp = new Map<string, number[]>();
  private all: number[] = [];
  constructor(private o = { perIp: 5, overall: 50, windowMs: 15 * 60_000 }) {}
  private recent(list: number[], now: number) {
    return list.filter((t) => now - t < this.o.windowMs);
  }
  /** Seconds until this IP may try again, or 0. */
  retryAfter(ip: string, now = Date.now()): number {
    const mine = this.recent(this.byIp.get(ip) ?? [], now);
    this.all = this.recent(this.all, now);
    const until = [mine.length >= this.o.perIp ? mine[0] : undefined, this.all.length >= this.o.overall ? this.all[0] : undefined]
      .filter((t): t is number => t !== undefined)
      .map((t) => t + this.o.windowMs);
    return until.length ? Math.ceil((Math.max(...until) - now) / 1000) : 0;
  }
  fail(ip: string, now = Date.now()) {
    this.byIp.set(ip, [...this.recent(this.byIp.get(ip) ?? [], now), now]);
    this.all.push(now);
    if (this.byIp.size > 10_000) this.byIp.clear();
  }
  clear(ip: string) {
    this.byIp.delete(ip);
  }
}

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const readCookie = (header: string | undefined) =>
  header?.split(/;\s*/).find((s) => s.startsWith(`${OWNER_COOKIE}=`))?.slice(OWNER_COOKIE.length + 1);

export function ownerAuth(opts: { passcode?: string; secure: boolean; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let passcode: Passcode | undefined;
  let setupError = "Set MISE_OWNER_PASSCODE to turn on owner sign-in.";
  if (opts.passcode) {
    try { passcode = new Passcode(opts.passcode); } catch (e) { setupError = (e as Error).message; }
  }
  const sessions = new Map<string, number>(); // sha256(token) -> expires at
  const failed = new FailedSignIns();
  const attrs = `HttpOnly; SameSite=Strict; Path=/${opts.secure ? "; Secure" : ""}`;

  const signedIn = (cookie: string | undefined) => {
    const token = readCookie(cookie);
    const exp = token ? sessions.get(digest(token)) : undefined;
    return exp !== undefined && exp > now();
  };

  const requireOwner: RequestHandler = (req, res, next) =>
    signedIn(req.headers.cookie) ? next() : void res.status(401).json({ error: "Sign in first." });

  const router = express.Router();
  router.post("/api/owner/sign-in", (req, res) => {
    if (!passcode) return res.status(503).json({ error: setupError });
    const ip = req.ip ?? "unknown";
    const wait = failed.retryAfter(ip, now());
    if (wait) return res.status(429).set("Retry-After", String(wait)).json({ error: "Too many wrong passcodes. Try again later." });
    if (!passcode.matches(req.body?.passcode)) {
      failed.fail(ip, now());
      return res.status(401).json({ error: "That passcode isn't right." });
    }
    failed.clear(ip);
    const token = randomBytes(32).toString("base64url");
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
    sessions.set(digest(token), now() + SESSION_MS);
    res.setHeader("Set-Cookie", `${OWNER_COOKIE}=${token}; ${attrs}; Max-Age=${SESSION_MS / 1000}`);
    res.status(204).end();
  });
  router.post("/api/owner/sign-out", (req, res) => {
    const token = readCookie(req.headers.cookie);
    if (token) sessions.delete(digest(token));
    res.setHeader("Set-Cookie", `${OWNER_COOKIE}=; ${attrs}; Max-Age=0`);
    res.status(204).end();
  });
  router.get("/api/owner/me", requireOwner, (_req, res) => res.json({ owner: true }));
  return { router, requireOwner };
}
```

- [ ] **Step 4:** Wire it in `createApp`: add `kitchen?: KitchenStore`, `ownerPasscode?: string` and `secureCookies?: boolean` to `AppOptions`; after `express.json`, `const owner = ownerAuth({ passcode: opts.ownerPasscode ?? process.env.MISE_OWNER_PASSCODE, secure: opts.secureCookies ?? process.env.NODE_ENV === "production" })`, `app.use(owner.router)`. Add `MISE_OWNER_PASSCODE` to `.env.example` if it exists; it's a one-line, owned-by-nobody change, so mention it in the report and let the orchestrator commit it.
- [ ] **Step 5:** `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit: `Add owner sign-in with a passcode and session cookie`

### Task D3: The proposal lifecycle

A proposal is a list of stock changes the owner hasn't booked yet. It's open until it's confirmed or discarded, and both of those are final.

```
           create (assistant, or later a receipt)
                 │
                 ▼
   ┌──────────► open ──── a newer event touches one of its items ───► open + stale
   │             │  │                                                    │
   │   refresh   │  └── discard ──► discarded (kept as a stub)           │
   └─────────────┼───────────────────────────────────────────────────────┘
                 │ confirm (not stale, every line checks out)
                 ▼
             confirmed (events written; confirming again returns the same result)
```

**Stale.** A proposal is stale when `basedOn` is behind the event count *and* one of the events after `basedOn` is for an item on one of its lines. Events the proposal wrote itself don't count. The confirm checks the stored lines and the edited ones, so an edit that moves a line onto an item that just changed is stale too.

Why this and not "any newer event": the count screen writes a dozen events in one save, and the assistant's proposals sit in the chat while the owner works. If every event made every open proposal stale, the owner would hit Refresh on nearly every card, learn to tap it without looking, and the check would stop protecting anything. What it protects against is real but item-shaped. A `count` line sets the amount outright, so booking "count eggs 360" after a newer count of 300 throws that count away. A `receive` line booked after the same delivery came in through the count screen counts it twice. Both only matter when the newer event is for the same item. Location is too fine (a move touches two locations, and the owner thinks "eggs", not "eggs in the walk-in"), and the plan or catalog changing doesn't change what's on the shelf.

**Refresh** re-checks the same lines against today's catalog and moves `basedOn` up to now. It doesn't call the model and doesn't change a line (owner's decision). A line that no longer checks out (the item was deleted, say) comes back with a `problems` entry, and a confirm refuses it until the owner edits it.

**Discard** keeps the proposal as a stub (owner's decision): status `discarded`, `discardedAt`, and its lines, so the card in the chat can still say what it was. It can't be confirmed or refreshed. Discarding twice returns the same stub.

**Confirm**, in this order:
1. Look it up. Unknown id: 404. Already confirmed: return the stored result, unchanged, with no new events. Discarded: 409.
2. Take the owner's edited lines if there are any (1 to 50), otherwise the stored ones.
3. Stale: 409, nothing written.
4. Check every line with `checkLine`: the item is known, the unit converts for it, the amount is a finite number at least 0, the location is known, a move has a different known location to go to, a price is a finite number at least 0. Any problem: 422 with one `problems` entry per line, nothing written.
5. Build the events. Event `i` gets the id `${proposal.id}-${i}`, the amount in base units, the price per base unit (`unitCost` on a line is per its own unit: $54 a case is $0.30 an egg), the line's `raw` text as its note, and `proposal: proposal.id`.
6. Append them all with one `store.append` call.
7. Mark the proposal confirmed, store the lines that were booked, `confirmedAt` and the event ids, and save.

Confirming twice can't write twice, for three reasons. `confirm` is synchronous from step 1 to step 7, and the route doesn't `await` anything before it, so two requests that arrive together run one after the other and the second finds it confirmed. If the process dies between steps 6 and 7, the proposal is still open on restart, and confirming again builds the same ids, which `store.append` skips (`FileStore` and, since step 0, `MemoryStore`). And a stale check ignores the proposal's own events, so that retry isn't refused as stale.

**Saving.** With `opts.file` set, the book is written to that file after every change, through a `.tmp` file and a rename, like the catalog. On start it reads the file back. A file that isn't JSON stops startup with the path in the message; a record that doesn't look like a proposal is skipped and counted in a warning. Confirmed and discarded proposals older than 30 days are dropped when saving.

**Files:** Modify `src/kitchen/proposals.ts`. Test: `test/kitchen/proposals.test.ts` (add to step 0's tests).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../src/kitchen/memory-store.js";
import { ProposalBook, ProposalError } from "../../src/kitchen/proposals.js";
import { onHand, total } from "../../src/kitchen/stock.js";
import type { Catalog, ProposalLine, StockEvent } from "../../src/kitchen/types.js";

const catalog: Catalog = {
  items: [
    { id: "eggs", name: "Eggs", aliases: [], baseUnit: "each", units: { case: 180 }, allergens: [] },
    { id: "flour", name: "Flour", aliases: [], baseUnit: "g", units: {}, allergens: [] },
  ],
  locations: [{ id: "walk-in", name: "Walk-in", shelfOrder: [] }, { id: "dry", name: "Dry storage", shelfOrder: [] }],
  recipes: [],
  plans: [],
};
const eggs: ProposalLine = { kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case", unitCost: 54, raw: "two cases eggs" };
const flour: ProposalLine = { kind: "receive", item: "flour", location: "dry", qty: 5, unit: "kg" };
const counted = (item: string, qty: number): StockEvent => ({ id: `m-${item}-${qty}`, at: "2026-12-04T17:00:00Z", kind: "count", item, location: "walk-in", qty, source: "manual" });
const setup = (file?: string, store = new MemoryStore(catalog)) => ({ store, book: new ProposalBook(store, { file, now: () => new Date("2026-12-04T18:00:00Z") }) });
const refused = (fn: () => unknown): ProposalError => {
  try { fn(); } catch (e) { if (e instanceof ProposalError) return e; throw e; }
  throw new Error("expected a ProposalError");
};
const eggCount = (store: MemoryStore) => total(onHand(store.events()), "eggs");

describe("proposal lifecycle", () => {
  it("writes nothing until it's confirmed", () => {
    const { store, book } = setup();
    book.create({ source: "chat", lines: [eggs] });
    expect(store.events()).toHaveLength(0);
  });

  it("books every line in one append, with ids from the proposal", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs, flour] });
    const r = book.confirm(p.id);
    expect(r.events).toEqual([`${p.id}-0`, `${p.id}-1`]);
    expect(eggCount(store)).toBe(360);
    expect(store.events()[0]).toMatchObject({ source: "chat", proposal: p.id, note: "two cases eggs" });
    expect(store.events()[0].unitCost).toBeCloseTo(0.3);
    expect(r.proposal).toMatchObject({ status: "confirmed", confirmedAt: "2026-12-04T18:00:00.000Z", events: r.events });
  });

  it("returns the same result when confirmed twice, and writes once", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    const first = book.confirm(p.id);
    expect(book.confirm(p.id, [{ ...eggs, qty: 9 }])).toEqual(first);
    expect(store.events()).toHaveLength(1);
  });

  it("writes once when two confirms arrive together", async () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    const [a, b] = await Promise.all([1, 2].map(() => Promise.resolve().then(() => book.confirm(p.id))));
    expect(a).toEqual(b);
    expect(store.events()).toHaveLength(1);
  });

  it("books the owner's edits, not the draft", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    book.confirm(p.id, [{ ...eggs, qty: 1 }]);
    expect(eggCount(store)).toBe(180);
    expect(book.get(p.id)?.lines[0].qty).toBe(1);
  });

  it("writes nothing if any line is bad, and says which", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs, flour] });
    for (const bad of [{ ...flour, unit: "qt" }, { ...flour, qty: Number.NaN }, { ...flour, qty: -1 }, { ...flour, qty: Infinity }, { ...flour, location: "attic" }, { ...flour, item: "sumac" }, { ...flour, kind: "move" as const, to: "dry" }]) {
      const e = refused(() => book.confirm(p.id, [eggs, bad]));
      expect(e.status).toBe(422);
      expect(e.problems[0]).toBeNull();
      expect(e.problems[1]).toEqual(expect.any(String));
    }
    expect(store.events()).toHaveLength(0);
    expect(book.get(p.id)?.status).toBe("open");
  });

  it("goes stale when a newer event touches one of its items", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    store.append([counted("eggs", 300)]);
    expect(book.get(p.id)?.stale).toBe(true);
    expect(refused(() => book.confirm(p.id)).status).toBe(409);
    expect(eggCount(store)).toBe(300);
  });

  it("stays fresh when newer events touch other items", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    store.append([counted("flour", 500)]);
    expect(book.get(p.id)?.stale).toBe(false);
    book.confirm(p.id);
    expect(eggCount(store)).toBe(360);
  });

  it("is stale when an edit moves a line onto an item that changed", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [flour] });
    store.append([counted("eggs", 300)]);
    expect(refused(() => book.confirm(p.id, [eggs])).status).toBe(409);
  });

  it("refresh re-checks the same lines and clears stale", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    store.append([counted("eggs", 300)]);
    const r = book.refresh(p.id);
    expect(r).toMatchObject({ id: p.id, stale: false, basedOn: 1, lines: p.lines });
    book.confirm(p.id);
    expect(eggCount(store)).toBe(660);
  });

  it("refresh flags a line the catalog no longer has", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs, flour] });
    store.saveCatalog({ ...catalog, items: catalog.items.filter((i) => i.id !== "flour") });
    const r = book.refresh(p.id);
    expect(r.problems[0]).toBeNull();
    expect(r.problems[1]).toMatch(/flour/);
    expect(refused(() => book.confirm(p.id)).status).toBe(422);
  });

  it("keeps a discarded proposal as a stub that can't be booked", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    const stub = book.discard(p.id);
    expect(stub).toMatchObject({ status: "discarded", discardedAt: "2026-12-04T18:00:00.000Z", lines: p.lines });
    expect(book.discard(p.id)).toEqual(stub);
    expect(book.list().map((x) => x.id)).toContain(p.id);
    expect(refused(() => book.confirm(p.id)).status).toBe(409);
    expect(refused(() => book.refresh(p.id)).status).toBe(409);
    expect(store.events()).toHaveLength(0);
  });

  it("won't discard a confirmed proposal, and doesn't know made-up ids", () => {
    const { book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    book.confirm(p.id);
    expect(refused(() => book.discard(p.id)).status).toBe(409);
    expect(refused(() => book.confirm("p-nope")).status).toBe(404);
  });

  it("finishes a confirm that died after writing its events", () => {
    const { store, book } = setup();
    const p = book.create({ source: "chat", lines: [eggs] });
    // The append happened, then the process stopped before the proposal was marked confirmed.
    store.append([{ id: `${p.id}-0`, at: "2026-12-04T18:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 360, source: "chat", proposal: p.id }]);
    expect(book.get(p.id)?.stale).toBe(false);
    book.confirm(p.id);
    expect(store.events()).toHaveLength(1);
  });

  it("keeps proposals across a restart", () => {
    const file = join(mkdtempSync(join(tmpdir(), "proposals-")), "ruki.proposals.json");
    const first = setup(file);
    const p = first.book.create({ source: "chat", lines: [eggs] });
    const result = first.book.confirm(p.id);
    const again = setup(file, first.store);
    expect(again.book.get(p.id)?.status).toBe("confirmed");
    expect(again.book.confirm(p.id)).toEqual(result);
    expect(first.store.events()).toHaveLength(1);
  });
});
```

- [ ] **Step 2:** `npx vitest run test/kitchen/proposals.test.ts`. Expected: FAIL, `confirm` is not a function.
- [ ] **Step 3: Implement.** Add to `ProposalBook`, without changing step 0's signatures:

```ts
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { factor, toBase } from "./units.js";
import type { ConfirmResult, StockEvent } from "./types.js";

const KEEP_DAYS = 30;

// In the constructor, after `this.now = ...`:
if (opts.file && existsSync(opts.file)) this.load(opts.file);

confirm(id: string, edits?: ProposalLine[]): ConfirmResult {
  const p = this.need(id);
  if (p.status === "confirmed") return { proposal: this.view(p), events: [...(p.events ?? [])] };
  if (p.status === "discarded") throw new ProposalError("This proposal was discarded.", 409);
  const lines = edits ?? p.lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > MAX_LINES) throw new ProposalError(`A proposal needs between 1 and ${MAX_LINES} lines.`);
  if (this.isStale(p, lines)) throw new ProposalError("Stock changed since this was made. Refresh it first.", 409);
  const c = this.store.catalog();
  const problems = lines.map((l) => checkLine(c, l));
  if (problems.some(Boolean)) throw new ProposalError(problems.filter(Boolean).join(" "), 422, problems);
  const at = this.now().toISOString();
  const events: StockEvent[] = lines.map((l, i) => {
    const item = c.items.find((x) => x.id === l.item)!;
    return {
      id: `${p.id}-${i}`, at, kind: l.kind, item: l.item, location: l.location,
      qty: toBase(item, l.qty, l.unit),
      ...(l.kind === "move" ? { to: l.to } : {}),
      source: p.source,
      ...(l.unitCost !== undefined ? { unitCost: l.unitCost / factor(item, l.unit) } : {}),
      ...(l.raw ? { note: l.raw } : {}),
      proposal: p.id,
    };
  });
  this.store.append(events);
  Object.assign(p, { lines: lines.map(cleanLine), status: "confirmed", confirmedAt: at, events: events.map((e) => e.id) });
  this.save();
  return { proposal: this.view(p), events: [...p.events!] };
}

discard(id: string): ProposalView {
  const p = this.need(id);
  if (p.status === "confirmed") throw new ProposalError("This proposal is already booked.", 409);
  if (p.status === "open") Object.assign(p, { status: "discarded", discardedAt: this.now().toISOString() });
  this.save();
  return this.view(p);
}

refresh(id: string): ProposalView {
  const p = this.need(id);
  if (p.status !== "open") throw new ProposalError("Only an open proposal can be refreshed.", 409);
  p.basedOn = this.store.events().length;
  this.save();
  return this.view(p);
}

protected need(id: unknown): Proposal {
  const p = typeof id === "string" ? this.all.get(id) : undefined;
  if (!p) throw new ProposalError("There's no proposal with that id.", 404);
  return p;
}

/** Stale: an event after `basedOn`, not written by this proposal, is for one of its items. */
protected isStale(p: Proposal, also: ProposalLine[] = []): boolean {
  const events = this.store.events();
  if (p.status !== "open" || p.basedOn >= events.length) return false;
  const items = new Set([...p.lines, ...also].map((l) => l.item));
  for (let i = p.basedOn; i < events.length; i++) if (events[i].proposal !== p.id && items.has(events[i].item)) return true;
  return false;
}

protected view(p: Proposal): ProposalView {
  const c = p.status === "open" ? this.store.catalog() : undefined;
  return { ...structuredClone(p), stale: this.isStale(p), problems: p.lines.map((l) => (c ? checkLine(c, l) : null)) };
}
```

  Also call `this.save()` at the end of `create`. `save()` drops confirmed and discarded proposals whose `confirmedAt` or `discardedAt` is more than `KEEP_DAYS` before `this.now()`, then writes `JSON.stringify([...this.all.values()])` to `${file}.tmp` and renames it over `file`. It does nothing without `opts.file`. `load(file)` parses the file (throwing `Invalid proposals file <path>: <reason>` if it isn't a JSON array) and keeps records with a string `id`, a known `status`, a number `basedOn` and an array of `lines`, warning with the count it skipped.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5:** Commit: `Confirm, discard and refresh proposals, and keep them on disk`

### Task D4: Kitchen routes

**Files:** Create `src/kitchen/api.ts`. Modify `src/server.ts`. Test: `test/kitchen/api.test.ts`.

Everything below is under `/api/kitchen` and behind `requireOwner`. Bodies and answers are JSON. Amounts are base units unless a field says otherwise.

| Method and path | Body or query | Answer |
|---|---|---|
| `GET /catalog` | | `Catalog` |
| `POST /catalog/:kind` | `kind` is `items`, `locations`, `recipes` or `plans`; the body is one record | Adds it or replaces the one with that id. `validateCatalog` on the result: 422 `{ error, errors }` if it fails. Otherwise `Catalog`. |
| `DELETE /catalog/:kind/:id` | | Removes it, same validation (deleting an item a recipe uses is a 422). `Catalog`. |
| `GET /stock` | | `StockView`: `{ basedOn: number; onHand: OnHand; lastCounted: Record<string, Record<string, string>> }`, the last count time per item and location |
| `GET /stock/:item/history` | | The item's last 50 `StockEvent`s, newest first |
| `POST /counts` | `{ clientId, location, lines: { item, qty, unit }[] }` | The count screen writes directly: it's the owner typing, not a model. Every line is checked as a `count` with `checkLine`; any problem is a 422 with `problems` and nothing written. Event ids are `count-${clientId}-${i}`, so a retried save writes once. `clientId` must match `/^[a-z0-9-]{8,64}$/`. Answer: `{ events: string[] }`. |
| `GET /today` | | `TodayView`, below |
| `GET /plans` | | `ProductionPlan[]`, by date |
| `GET /plans/:id/result` | | `PlanResult` from `explode` against what's on hand, with `recipeName` on each prep task and `name` on each shopping line |
| `GET /cost` | `?item&qty&unit` | `batchCost`: `{ cost, missing }` |
| `GET /max-batch` | `?item&unit` | `{ max: number \| null }`, `null` when stock doesn't limit it |
| `GET /proposals` | `?status=open` (optional) | `ProposalView[]`, newest first |
| `GET /proposals/:id` | | `ProposalView` |
| `POST /proposals/:id/confirm` | `{ lines?: ProposalLine[] }` | `ConfirmResult` |
| `POST /proposals/:id/discard` | `{}` | `ProposalView` |
| `POST /proposals/:id/refresh` | `{}` | `ProposalView` |
| `POST /assistant` | `{ sessionId, message }` (sessionId up to 100 chars, message up to 2000) | `AssistantReply`. Rate limited with a `RateLimiter(limits.perMinute)` keyed `owner`, refused with 503 once `ledger.spentToday() >= limits.dailyBudgetUsd`, and logged with `ledger.logTurn` (`channel: "kitchen"`) so the owner's spend counts toward the same daily cap. |

```ts
export interface TodayView {
  date: string; // the plan's date, or today when there's no plan ahead
  plan: ProductionPlan | null; // the first plan on or after today
  prep: (PrepTask & { recipeName: string })[];
  shopping: (ShoppingLine & { name: string })[];
  preorders: GuestPreorder[];
}
/** What Today shows of a preorder: no phone, no notes, no last name. */
export interface GuestPreorder {
  firstName: string; // "" once retention has removed the name
  pickupTime: string;
  items: { name: string; quantity: number }[];
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
```

`ProposalError` maps to its `status` with `{ error, problems }`, `UnitError` to 422, a bad `kind` or a missing query value to 400, and anything else to 500 with a generic message (log the error, don't send it). The confirm route calls `proposals.confirm` straight away, with no `await` in front of it: that's what makes two concurrent confirms safe.

- [ ] **Step 1: Write the failing tests.** Start a server as in `test/owner-auth.test.ts`, with `kitchen: new MemoryStore(<the ruki kitchen>)`, sign in once in `beforeAll` and keep the cookie. A `kitchen(path, init?)` helper adds the cookie and the JSON content type. The proposal needs to exist before it can be confirmed over HTTP, and the assistant isn't built yet, so the test makes one through a `proposals` option: add `proposals?: ProposalBook` to `AppOptions` for tests.

```ts
it("confirms once when two confirms arrive together over HTTP", async () => {
  const p = book.create({ source: "chat", lines: [{ kind: "receive", item: "eggs", location: "walk-in", qty: 2, unit: "case" }] });
  const before = (await (await kitchen("/stock")).json()).basedOn;
  const [a, b] = await Promise.all([1, 2].map(() => kitchen(`/proposals/${p.id}/confirm`, { method: "POST", body: "{}" })));
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(await a.json()).toEqual(await b.json());
  expect((await (await kitchen("/stock")).json()).basedOn).toBe(before + 1);
});

it("refuses a stale confirm with 409 and books it after a refresh", async () => {
  const p = book.create({ source: "chat", lines: [{ kind: "count", item: "eggs", location: "walk-in", qty: 360, unit: "each" }] });
  await kitchen("/counts", { method: "POST", body: JSON.stringify({ clientId: "count-test-0001", location: "walk-in", lines: [{ item: "eggs", qty: 300, unit: "each" }] }) });
  expect((await kitchen(`/proposals/${p.id}/confirm`, { method: "POST", body: "{}" })).status).toBe(409);
  const fresh = await (await kitchen(`/proposals/${p.id}/refresh`, { method: "POST", body: "{}" })).json();
  expect(fresh.stale).toBe(false);
  expect((await kitchen(`/proposals/${p.id}/confirm`, { method: "POST", body: "{}" })).status).toBe(200);
});

it("writes a retried count once", async () => {
  const body = JSON.stringify({ clientId: "count-test-0002", location: "dry", lines: [{ item: "flour", qty: 2, unit: "kg" }] });
  const one = await (await kitchen("/counts", { method: "POST", body })).json();
  const two = await (await kitchen("/counts", { method: "POST", body })).json();
  expect(two.events).toEqual(one.events);
  const history = await (await kitchen("/stock/flour/history")).json();
  expect(history.filter((e: { id: string }) => e.id.startsWith("count-test-0002"))).toHaveLength(1);
});

it("refuses a catalog change that breaks a recipe", async () => {
  const res = await kitchen("/catalog/items/flour", { method: "DELETE" });
  expect(res.status).toBe(422);
  expect((await res.json()).errors.join(" ")).toMatch(/flour/);
});

it("shows preorders on Today without phones, notes or last names", async () => {
  // Place an order through the RestaurantStore passed in as `store`, for "Anna Petrova", 510-555-0101, notes "gate code 1234".
  const today = await (await kitchen("/today")).json();
  const text = JSON.stringify(today.preorders);
  expect(today.preorders[0]).toEqual({ firstName: "Anna", pickupTime: "11:00", items: [{ name: "Syrniki", quantity: 2 }] });
  expect(text).not.toMatch(/Petrova|555|1234/);
});

it("names prep tasks by recipe, not by id", async () => {
  const today = await (await kitchen("/today")).json();
  expect(today.prep.every((t: { recipe: string; recipeName: string }) => t.recipeName && t.recipeName !== t.recipe)).toBe(true);
});

it("answers null for a max batch that stock doesn't limit", async () => {
  // Until G1 lands, maxBatch returns its search limit, so this checks the route's mapping with a stubbed number.
  expect((await (await kitchen("/max-batch?item=syrniki&unit=order")).json()).max).toEqual(expect.any(Number));
});
```

  Plus one test per route in the table for its happy path and its 400 or 404.
- [ ] **Step 2:** `npx vitest run test/kitchen/api.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `kitchenRouter(deps)` in `src/kitchen/api.ts` as an `express.Router()` with the routes above. `available` for `explode` and `maxBatch` is `totals(onHand(store.events()))`. In `max-batch`, send `{ max: Number.isFinite(n) ? n : null }`.
- [ ] **Step 4: Wire it** in `createApp`, replacing D2's placeholder:

```ts
const kitchen = opts.kitchen ?? kitchenStore(config.id); // FileStore(DATA_DIR, id, seed) when DATA_DIR is set, else MemoryStore(seed), seed from data/kitchens/<id>.json
const proposals = opts.proposals ?? new ProposalBook(kitchen, { file: process.env.DATA_DIR ? join(process.env.DATA_DIR, `${config.id}.proposals.json`) : undefined });
const assistant = createKitchenAssistant({ store: kitchen, proposals, llm, now });
app.use("/api/kitchen", owner.requireOwner, kitchenRouter({ store: kitchen, proposals, assistant, orders: () => store.orders, today: () => localDate(now(), config.timezone), ledger, limits }));
```

  Without `DATA_DIR`, log once that kitchen stock isn't saved, the way the ledger does.
- [ ] **Step 5:** `npm test && npm run loadtest -- 300 50`. Expected: PASS.
- [ ] **Step 6:** Commit: `Add the kitchen API behind owner sign-in`

### Task D5: Index fallback, guest menu and privacy notice

Three small changes to `src/server.ts` that the screens need.

**Files:** Modify `src/server.ts`. Test: `test/server.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it("serves the app's index.html for app routes once web/dist is built", async () => {
  // createApp gets `webDist` (a temp dir with index.html and assets/app.js) through a test-only option.
  for (const path of ["/count", "/order", "/stock/eggs"]) {
    const res = await fetch(`${url}${path}`, { headers: { accept: "text/html" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<div id=\"root\">");
  }
  expect((await fetch(`${url}/api/nope`, { headers: { accept: "text/html" } })).status).toBe(404);
  expect((await fetch(`${url}/admin/nope`, { headers: { accept: "text/html" } })).status).not.toBe(200);
  expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404);
});

it("tells guests what is kept, for how long, and who can read it", async () => {
  const { privacyNotice } = await (await fetch(`${base}/api/config`)).json();
  for (const word of [/name/, /phone/, /notes/, /chat/, /30 days/, /owner can read/]) expect(privacyNotice).toMatch(word);
});

it("sends the menu with prices for /order", async () => {
  const { menu } = await (await fetch(`${base}/api/config`)).json();
  expect(menu.find((m: { id: string }) => m.id === "syrniki")).toMatchObject({ name: "Syrniki", price: 12 });
});
```

- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Index fallback.** After every route (and the admin router), when the static dir is `web/dist`:

    ```ts
    app.use((req, res, next) => {
      if (req.method !== "GET" || /^\/(api|admin)(\/|$)/.test(req.path) || extname(req.path) || !req.accepts("html")) return next();
      res.set("Cache-Control", "no-cache").sendFile(join(dir, "index.html"));
    });
    ```

    A path with an extension (`/assets/missing.js`) stays a 404, so a missing script never comes back as HTML.
  - **Privacy notice.** Replace the text in `/api/config` with this, where `days` is `retainDays()`:

    > We keep your name, phone number, order notes and what you write in this chat for {days} days, then delete them. The owner can read them, to prepare your order and to improve the assistant.

  - **Menu.** Add `menu: config.menu.map(({ id, name, category, price, description, allergens, dietary }) => ({ id, name, category, price, description, allergens, dietary }))` to `/api/config`. Guests see prices (owner's decision). `quantity` stays out; G adds what's left.
- [ ] **Step 4:** `npm test && npm run web:build && npm start`, then open `/count` directly and reload it. Expected: the app, not a 404.
- [ ] **Step 5:** Commit each on its own: `Serve the app's index page for its own routes`, `Say on /order what's kept and who reads it`, `Send the menu with prices to the order page`

---
