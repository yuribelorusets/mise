# Wave 0: cleanup, agents, shared interfaces

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to work through this task by task. Steps use checkboxes (`- [ ]`).

**Goal:** Remove what doesn't fit the kitchen tool, add the agent definitions the build needs, and fix the shared kitchen types so wave 1 can build against them in parallel.

**Architecture:** The guest preorder flow stays. Restaurant mode (reservations), the Fennel & Ash config and the Twilio channel go. The kitchen domain starts as a types module plus an in-memory store.

**Tech stack:** TypeScript, Express 5, vitest, fast-check.

**Spec:** [docs/design/kitchen-v1.md](../design/kitchen-v1.md) · **Master plan:** [kitchen-v1.md](kitchen-v1.md)

## Global constraints

The master plan's global constraints apply. In addition:
- Task 0.3 runs alone on `feat/cleanup`. Nothing else runs while it's in progress.
- Old ledgers on disk may still contain `"kind":"reservation"` lines. Replay must skip them, not crash.

---

### Task 0.1: Commit the plans

**Files:** `docs/plans/kitchen-v1.md`, `docs/plans/wave-0.md`, `docs/plans/wave-1.md`

- [ ] **Step 1:** `git add docs/plans && git commit -m "Add the v1 build plan"`

---

### Task 0.2: Agent definitions

**Files:**
- Create: `.claude/agents/builder.md`, `.claude/agents/frontend-builder.md`, `.claude/agents/security-reviewer.md`
- Modify: `notes/agent-workflow.md` (the roster table; this file isn't tracked in git)

- [ ] **Step 1: Write `builder.md`**

```markdown
---
name: builder
description: Builds one Mise work package from its task plan, in its own worktree and branch. Use for backend packages in docs/plans/. Only touches the files its package owns.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---

You build one work package. Your brief names the package, its task plan section and the files you own.

Before starting, read `CLAUDE.md`, `docs/design/kitchen-v1.md`, `docs/plans/kitchen-v1.md` and your package's section of the wave plan.

For each task:
1. Write the failing test from the plan. Run it and check that it fails for the reason the plan says.
2. Write the smallest code that makes it pass. Run it.
3. Run `npm run typecheck && npm test`. Everything must pass.
4. Commit following `CLAUDE.md`: one change, short plain subject, no trailers.

Rules:
- Only edit files your package owns. If you need a change elsewhere (including `src/kitchen/types.ts`), stop and say what and why.
- Don't push, merge, rebase or switch branches.
- Don't call Claude: run evals only with `--llm mock`.
- If the plan is wrong (a test can't fail, a signature doesn't fit), say so instead of working around it.

Report: the commits you made (`git log --oneline main..HEAD`), the test output, and anything you skipped or doubted.
```

- [ ] **Step 2: Write `frontend-builder.md`**

```markdown
---
name: frontend-builder
description: Builds Mise frontend packages in web/ (React, Vite, TypeScript) from their task plan, in its own worktree and branch. Use for frontend packages in docs/plans/.
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---

You build one frontend package in `web/`. Your brief names the package, its task plan section and the files you own.

Before starting, read `CLAUDE.md`, `docs/design/kitchen-v1.md` (especially "Frontend"), `docs/plans/kitchen-v1.md` and your package's section of the wave plan. Use the frontend-design skill for visual decisions.

The design direction is a printed prep sheet, not a dashboard:
- high contrast, numbers in aligned columns (tabular figures)
- tap targets of at least 44 px, usable with wet hands
- a dark mode
- no UI kit; plain CSS with variables in `web/src/styles/tokens.css`, plus a few components of our own

For each task: write the test, make it pass, run `npm --prefix web run build && npm --prefix web test`, commit following `CLAUDE.md`.

Rules:
- Only edit files your package owns. Don't push, merge or switch branches.
- Check every screen at 375 px wide and at desktop width before reporting done.

Report: commits, test and build output, screenshots or a description of each screen, and open questions about the design.
```

- [ ] **Step 3: Write `security-reviewer.md`**

```markdown
---
name: security-reviewer
description: Reviews a Mise branch or wave for privacy, security and robustness, and proves each finding with a failing test or eval scenario. Use on every branch before merge and after each wave.
tools: Read, Grep, Glob, Bash, Edit, Write
model: sonnet
---

You look for ways the change could leak data, be abused, or break. Review `git diff main...HEAD` unless your brief names something else. Use the built-in security review checklist as a starting point.

Check:
- **Privacy:** personal data (names, phones, card digits, loyalty numbers, addresses) in logs, the ledger or responses; retention; storing only what's needed; raw photos kept by default.
- **Security:** owner routes require a session; cookie flags (HttpOnly, Secure, SameSite); cross-site request forgery on state-changing routes; upload type and size limits and decompression bombs; rate and spend limits on anything that calls a model; secrets in the client bundle or logs.
- **Prompt injection:** guest text or receipt text that tries to change the agent's rules; a proposal containing items or amounts the user didn't give.
- **Robustness:** zero, negative, NaN and huge amounts; unit mismatches; confirming a proposal twice; a proposal made stale by a newer count; recipe cycles; concurrent confirms; malformed JSON; old ledger lines.

For each finding, write a failing test in `test/` or a scenario in `evals/` that shows it. You may only create or edit files in `test/`, `evals/` and `docs/security-backlog.md`.

Report at most 10 findings, most serious first:

    [high|medium|low] file:line  What's wrong, how it's exploited or triggered, and the test that shows it.

High means a real user's data leaks, money is spent, stock is wrong, or the app can be taken over. It blocks the merge. Append medium and low findings to `docs/security-backlog.md`.
If you find nothing serious, say so in one line.
```

- [ ] **Step 4:** Add the three agents to the roster table in `notes/agent-workflow.md`.
- [ ] **Step 5:** `git add .claude/agents && git commit -m "Add builder, frontend-builder and security-reviewer agents"`

---

### Task 0.3: Remove the phone channel, Fennel & Ash and table reservations

**Agent:** builder, on `feat/cleanup`, running alone.

**Files:** most of `src/`, `test/`, `evals/`, `public/admin.html`, `data/restaurants/`, `README.md`, `.env.example`, `render.yaml`.

This is three commits, in this order. After each one, `npm run typecheck && npm test && npm run loadtest -- 300 50` must pass.

#### Commit 1: Remove the phone channel

- [ ] Delete `src/channels/twilio.ts`.
- [ ] `src/server.ts`: remove the twilio import, `twilioGuard`, `/voice/incoming` and `/voice/turn`. `guardedTurn`'s channel type becomes `"chat"`.
- [ ] `src/agent/prompt.ts`: remove `voice()` and the `"voice"` channel. `Channel` becomes `"chat" | "eval"`.
- [ ] `test/core.test.ts`: remove `describe("twilio")`. `test/server.test.ts`: remove "answers a phone turn with TwiML".
- [ ] `.env.example` and `render.yaml`: remove `TWILIO_AUTH_TOKEN`, `PUBLIC_BASE_URL`, `MANAGER_PHONE`.
- [ ] `README.md`: remove "Put it on a phone number", "Phone calls" mentions in the feature table and architecture diagram.
- [ ] Run the checks. Commit: `Remove the phone channel`.

#### Commit 2: Remove the Fennel & Ash demo restaurant

- [ ] Delete `data/restaurants/fennel-ash.json` and `evals/scenarios/core.yaml`.
- [ ] `evals/scenarios/redteam.yaml`: delete every scenario without `restaurant: ruki` (including `sim-fennel-flexible-booking` and the booking-in-the-past case).
- [ ] `src/domain/restaurant.ts`: `loadRestaurant`'s default becomes `"ruki"`.
- [ ] `src/evals/run.ts`: the scenario default `s.restaurant ?? "fennel-ash"` becomes `"ruki"`, in both places.
- [ ] Tests that load the default restaurant or Fennel (`test/core.test.ts`, `test/robustness.test.ts`, `test/server.test.ts`): switch them to Ruki where the behavior still exists (menu search, allergen filter, agent loop, time zones, chat endpoint, guardrails). Delete the ones that only test reservations: "rejects Mondays, off-hours and oversized parties", "offers alternatives for a full slot", "emits a CRM event when a reservation is created", "books a table end to end", "never books more tables than a slot has". Replace "books a table end to end" with "places a preorder end to end across tool calls" using `MockLLM(loadRestaurant("ruki"))`, the same messages as `ruki-preorder-asks-window`, and assert one order exists with total 28.
- [ ] `test/evals.test.ts`: rename "has scenarios in all four languages" to "loads the scenario suite", keeping `>= 12`.
- [ ] `.env.example`: `MISE_RESTAURANT=ruki`, and update the comment.
- [ ] `README.md`: remove Fennel & Ash from the intro and examples. Leave the rest for the wave 3 rewrite.
- [ ] Run the checks. Commit: `Remove the Fennel & Ash demo restaurant` with body `Ruki is the default now.`

#### Commit 3: Remove the table reservation code

- [ ] `src/domain/restaurant.ts`: remove `Reservation`, `booked`, `reservations`, `slotProblem`, `checkAvailability`, `createReservation`, and the `mode`, `seating` and `hours` fields (and their checks in `loadRestaurant`). `Recorder.record` takes `(kind: "order", value: Order)`. Keep `windows`, `placeOrder`, `normTime`, `localDate`, `localTime`, `weekday`.
- [ ] `data/restaurants/ruki.json`: remove `mode`, `seating`, `hours`.
- [ ] `src/agent/tools.ts`: remove `check_availability` and `create_reservation`, and the mode branching in `toolSpecs` (pop-up tools only). Keep the "refuses a tool it wasn't given" check.
- [ ] `src/agent/prompt.ts`: remove the restaurant prompt. `systemPrompt` returns the pop-up prompt.
- [ ] `src/agent/agent.ts`: drop `create_reservation` from the confirmed-action filter (line ~42) and `reservations` from the issued-code set (line ~113).
- [ ] `src/llm/mock.ts`: remove the reservation intent and the `pickupOnly` branch's restaurant counterpart. Keep the pop-up's "there are no tables" reply.
- [ ] `src/evals/graders.ts`: remove `new_reservations` and `reservation` from `end_state`, and their grading.
- [ ] `src/integrations/webhook.ts`: remove `reservation.created` from `MiseEventType`.
- [ ] `src/ops/ledger.ts`: remove reservations. **Replay must skip old `"kind":"reservation"` lines.** Add a test in `test/popup.test.ts`:

```ts
it("skips reservation lines left in an old ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "mise-"));
  appendFileSync(join(dir, "ruki.jsonl"),
    JSON.stringify({ kind: "reservation", at: "2026-11-01T00:00:00Z", value: { code: "FA-ABC123" } }) + "\n" +
    JSON.stringify({ kind: "order", at: "2026-11-01T00:00:00Z", value: { id: "RK-ABC123", items: [] } }) + "\n");
  const ledger = new Ledger(dir, "ruki");
  expect(ledger.orders).toHaveLength(1);
});
```

- [ ] `src/ops/admin.ts` and `public/admin.html`: remove reservation counts and lists.
- [ ] `test/robustness.test.ts`: remove reservation fields from the "tool inputs a confused model might send" cases that use them, and delete cases that only make sense for bookings (February 30th, party size "lots"). The date checks were real fixes, so keep the impossible-date validation test if a pop-up path still parses dates; if none does, delete it and say so in the report.
- [ ] Run the checks, plus `grep -rniE "reservation|fennel|twilio|seating|slotProblem" src test evals data public scripts .env.example render.yaml` (expected: nothing, except the old-ledger test). Commit: `Remove the table reservation code`.

Report the three commits and the final test count.

---

### Task 0.4: Kitchen interfaces

**Files:**
- Create: `src/kitchen/types.ts`, `src/kitchen/memory-store.ts`
- Test: `test/kitchen/memory-store.test.ts`

**Produces:** every type below, used unchanged by wave 1 package A and wave 2.

- [ ] **Step 1: Write `src/kitchen/types.ts`**

```ts
// Shared kitchen types. Wave 1 builds against these; change them only through the orchestrator.

export type BaseUnit = "g" | "ml" | "each";

export interface Item {
  id: string; // kebab-case, stable
  name: string;
  aliases: string[]; // other names, including ones learned from receipts
  baseUnit: BaseUnit;
  /** Item-specific units, in base units: { case: 180, dozen: 12 } for eggs, { order: 1 } for syrniki. */
  units: Record<string, number>;
  category?: string;
  allergens: string[];
  /** Par level in base units. */
  par?: number;
  shelfLifeDays?: number;
}

export interface Location {
  id: string;
  name: string;
  /** Item ids in shelf order, for the count screen. */
  shelfOrder: string[];
}

export interface Component {
  item: string;
  qty: number;
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  /** The item this recipe makes. Every recipe makes exactly one item. */
  makes: string;
  yield: { qty: number; unit: string };
  components: Component[];
  draft?: boolean;
}

export interface PlanLine {
  item: string;
  qty: number;
  unit: string;
  source: "manual" | "preorder";
}

export interface ProductionPlan {
  id: string;
  date: string; // YYYY-MM-DD
  lines: PlanLine[];
}

export interface Catalog {
  items: Item[];
  locations: Location[];
  recipes: Recipe[];
  plans: ProductionPlan[];
}

export type StockKind = "receive" | "use" | "waste" | "count" | "move";
export type StockSource = "manual" | "chat" | "receipt" | "preorder" | "production";

export interface StockEvent {
  id: string;
  at: string; // ISO time
  kind: StockKind;
  item: string;
  location: string;
  /** Base units. Always >= 0: the kind says which way it goes. For a count, the amount found. */
  qty: number;
  /** Destination location, for a move. */
  to?: string;
  source: StockSource;
  /** Price paid per base unit, for a receive. */
  unitCost?: number;
  note?: string;
  proposal?: string;
}

export interface ProposalLine {
  kind: StockKind;
  item: string;
  location: string;
  qty: number;
  unit: string;
  to?: string;
  unitCost?: number;
  /** The text this line came from ("two cases eggs"). */
  raw?: string;
}

export interface Proposal {
  id: string;
  createdAt: string;
  source: StockSource;
  lines: ProposalLine[];
  status: "open" | "confirmed" | "discarded";
  /** Number of stock events when the proposal was made, so a confirm can tell it's stale. */
  basedOn: number;
}

export interface KitchenStore {
  catalog(): Catalog;
  saveCatalog(c: Catalog): void;
  events(): readonly StockEvent[];
  append(events: StockEvent[]): void;
}
```

- [ ] **Step 2: Write the failing test** `test/kitchen/memory-store.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { MemoryStore } from "../../src/kitchen/memory-store.js";

const empty = { items: [], locations: [], recipes: [], plans: [] };

describe("MemoryStore", () => {
  it("appends events in order and returns a copy of the catalog", () => {
    const s = new MemoryStore(empty);
    s.append([{ id: "e1", at: "2026-12-01T10:00:00Z", kind: "receive", item: "eggs", location: "walk-in", qty: 180, source: "manual" }]);
    expect(s.events().map((e) => e.id)).toEqual(["e1"]);
    const c = s.catalog();
    c.items.push({ id: "x", name: "x", aliases: [], baseUnit: "g", units: {}, allergens: [] });
    expect(s.catalog().items).toHaveLength(0);
  });
});
```

- [ ] **Step 3:** `npx vitest run test/kitchen/memory-store.test.ts`. Expected: FAIL, cannot find `memory-store.js`.
- [ ] **Step 4: Write `src/kitchen/memory-store.ts`**

```ts
import type { Catalog, KitchenStore, StockEvent } from "./types.js";

/** Keeps everything in memory. For tests, and for running without a data directory. */
export class MemoryStore implements KitchenStore {
  private cat: Catalog;
  private log: StockEvent[] = [];
  constructor(catalog: Catalog) { this.cat = structuredClone(catalog); }
  catalog(): Catalog { return structuredClone(this.cat); }
  saveCatalog(c: Catalog) { this.cat = structuredClone(c); }
  events(): readonly StockEvent[] { return this.log; }
  append(events: StockEvent[]) { this.log.push(...events.map((e) => ({ ...e }))); }
}
```

- [ ] **Step 5:** Run it, then `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6:** `git add src/kitchen test/kitchen && git commit -m "Add the shared kitchen types and an in-memory store"`

---

### Task 0.5: Serve the new frontend when it's built

**Files:** Modify `src/server.ts` (the `express.static` line). Test: `test/server.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
it("serves the built web app when web/dist exists, and the old pages otherwise", async () => {
  const { staticDir } = await import("../src/server.js");
  expect(staticDir(() => true)).toMatch(/web[\\/]dist$/);
  expect(staticDir(() => false)).toMatch(/public$/);
});
```

- [ ] **Step 2:** Run it. Expected: FAIL, `staticDir` is not exported.
- [ ] **Step 3: Implement** in `src/server.ts`

```ts
import { existsSync } from "node:fs";

const WEB_DIST = fileURLToPath(new URL("../web/dist", import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
/** The React app once it's built; the old static pages until then. */
export const staticDir = (exists: (p: string) => boolean = existsSync) => (exists(WEB_DIST) ? WEB_DIST : PUBLIC_DIR);
```

and replace the static line with `app.use(express.static(staticDir()));`.

- [ ] **Step 4:** `npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5:** `git commit -am "Serve web/dist when the new frontend is built"`
