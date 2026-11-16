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
