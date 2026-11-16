# Mise v1 build plan

**Spec:** [docs/design/kitchen-v1.md](../design/kitchen-v1.md)

This is the map: waves, work packages, who builds what, which files each package owns, and how branches come back together. The step-by-step task plans for each wave live next to it:

- [wave-0.md](wave-0.md): cleanup, agent definitions, shared interfaces
- [wave-1.md](wave-1.md): kitchen core, frontend shell and mockup, guardrails and eval tooling
- [wave-2.md](wave-2.md): kitchen API and owner sign-in, assistant, screens on live data, preorders in the plan
- Wave 3 gets its own task plan once wave 2 is merged.

## Global constraints

- Node 20+, TypeScript strict, ES modules, vitest. No new runtime dependencies in `src/` without a reason in the commit message.
- Business rules live in code (`src/kitchen/`, `src/domain/`), not in prompts.
- Nothing a model produces is written to stock or the catalog without a confirmed proposal.
- Amounts are stored in base units (`g`, `ml`, `each`). Other units are conversions.
- Every bug fix or rule comes with a test that failed before it.
- Commits follow `CLAUDE.md`: one change each, short plain subject, no trailers.
- Model spend: every eval run that calls Claude uses `--max-usd` once it exists (wave 1, package C). Before that, only run evals with `--llm mock`.

## Agents

| Agent | Model | Writes | Used for |
|---|---|---|---|
| orchestrator (main session) | Opus | anything, but only between waves or for merges | design, shared interfaces, merging, plans |
| builder | Sonnet | its package's files only | one work package, in its own worktree |
| frontend-builder | Sonnet | `web/` and its package's files | frontend packages |
| test-writer | Sonnet | `test/`, `evals/` | failing tests for a described bug |
| reviewer | Sonnet | nothing | correctness and project rules, per branch |
| security-reviewer | Sonnet | `test/`, `evals/`, `docs/security-backlog.md` | privacy, security, robustness, per branch and per wave |
| eval-triager | Sonnet | nothing | running evals and sorting failures |
| explorer | Haiku | nothing | lookups |

The builder, frontend-builder and security-reviewer definitions are added in wave 0. Agents defined during a session can't be called by name until a new session starts. Until then the orchestrator passes the definition's instructions to a general-purpose agent.

## Branch and merge protocol

1. The orchestrator starts each package as a builder in its own worktree on `feat/<package>`, branched from the current `main`.
2. The builder works through its task plan: failing test, code, passing test, commit. It doesn't push, merge or touch files outside its package.
3. When the builder reports done, the orchestrator runs **reviewer** and **security-reviewer** on the branch, in parallel.
4. Findings:
   - reviewer findings and security findings rated high go back to the builder (or a fresh builder) on the same branch
   - security findings rated medium or low go into `docs/security-backlog.md` in their own commit
5. The orchestrator rebases the branch onto `main` and runs the full check: `npm run typecheck && npm test && npm run loadtest -- 300 50`, plus `npm --prefix web run build && npm --prefix web test` once `web/` exists. Then it fast-forwards `main` and pushes.
6. After each wave, security-reviewer does one pass over everything the wave merged.

The history stays linear, and every commit on `main` passes the tests.

## Waves and packages

### Wave 0: orchestrator, in order

| # | What | Branch | Owner |
|---|---|---|---|
| 0.1 | Commit these plans | `main` | orchestrator |
| 0.2 | Add builder, frontend-builder and security-reviewer definitions | `main` | orchestrator |
| 0.3 | Remove the phone channel, Fennel & Ash and table reservations | `feat/cleanup` | builder, running alone because it touches most files |
| 0.4 | Kitchen interfaces: `src/kitchen/types.ts` and an in-memory store | `main` | orchestrator |
| 0.5 | Express serves `web/dist` when it exists, otherwise `public/` | `main` | orchestrator |

### Wave 1: three in parallel

| Pkg | What | Branch | Agent | Owns |
|---|---|---|---|---|
| A | Kitchen core: units, catalog checks, stock, netting, prep and shopping lists, cost, max batch, file store | `feat/kitchen-core` | builder | `src/kitchen/**` except `types.ts`, `test/kitchen/**`, `data/kitchens/**` |
| B | Frontend shell, plus a static Today and Count mockup. ✋ Stops for owner approval of the look. | `feat/web-shell` | frontend-builder | `web/**`, `package.json`, `.github/workflows/ci.yml` |
| C | Guardrails and eval tooling: per-phone preorder cap, data retention, privacy notice text, `live` tag, `--max-usd` | `feat/guardrails` | builder | `src/domain/restaurant.ts`, `src/ops/ledger.ts`, `src/ops/guardrails.ts`, `src/evals/run.ts`, `src/server.ts`, `data/restaurants/ruki.json`, `scripts/loadtest.ts`, `test/evals.test.ts`, `test/popup.test.ts`, `test/server.test.ts`, `test/robustness.test.ts` |

None of these overlap. `src/kitchen/types.ts` is read-only during wave 1. A change to it goes through the orchestrator.

### Wave 2: planned after wave 1 merges

| Pkg | What | After |
|---|---|---|
| D | Kitchen REST API (`/api/kitchen/*`), proposals with confirm and discard, owner passcode and session cookie | A |
| E | Kitchen assistant: tools, owner prompt, `evals/scenarios/kitchen.yaml` | A |
| F | Screens wired to the API: Today, Count, Stock, Recipes, Plan, Assistant with proposal cards, `/order` | B, D |
| G | Preorders feed the production plan; max batch replaces the fixed menu `quantity` | A, C |

D and E can run in parallel (D owns `src/server.ts` and `src/kitchen/api.ts`, E owns `src/kitchen/assistant/**`). F starts once D merges. G is last in the wave, since it touches the preorder store and the kitchen plan.

### Wave 3

- H. Playwright smoke tests in CI
- An eval run on Haiku, then one on Sonnet, both with `--max-usd`, triaged by eval-triager
- Docs: scaling design note, `docs/agents.md` with measured cost, README rewrite around the kitchen tool

### v2, later

Receipt capture with name learning and receipt evals; barcodes through Open Food Facts; offline counting.

## Owner checkpoints

- Approve the Today and Count mockup (wave 1, B)
- Ruki's real recipes and yields, which replace the drafts in `data/kitchens/ruki.json` (any time before wave 2, G)
- Any high-severity security finding
- Before each Claude eval run: the `--max-usd` amount

## Usage

- At most three builders at once. Reviews only read, so they cost less.
- Each builder gets a self-contained brief: the spec, the master plan, its wave plan section, and its file list. It shouldn't need this conversation.
- Model spend for v1 stays under about $2, capped by `--max-usd` and the $5 Console limit.
