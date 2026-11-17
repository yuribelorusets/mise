# Testing

There are five kinds of checks: unit tests, web tests, browser tests, evals and a load test. None of them costs money on the mock. Evals call Claude when `ANTHROPIC_API_KEY` is set and I leave out `--llm mock`. Install with `npm ci` and `npm --prefix web ci`.

## Unit tests

```
npm test
npm run typecheck
```

`npm test` runs vitest from the repo root (`vitest.config.ts`). It skips `web/` and `.claude/`. It covers:

- **Kitchen core**, in `test/kitchen/`: units, catalog validation, the stock log, plan explosion, cost and max batch, preorders, proposals (including stale), the file store and the kitchen API. `test/kitchen/ruki.test.ts` runs the real Ruki catalog from `data/kitchens/ruki.json`.
- **The kitchen assistant**, in `test/kitchen/assistant/`.
- **Guest side and server**: `test/core.test.ts`, `test/popup.test.ts`, `test/server.test.ts`.
- **Owner sign-in and request guards**: `test/owner-auth.test.ts`, `test/request-guards.test.ts`.
- **Robustness and retention**: `test/robustness.test.ts`, `test/retention-live.test.ts`, `test/limits-env.test.ts`.
- **The eval suite itself**, `test/evals.test.ts`, covered below.

Server tests start the real app on a random port with the mock model and an in-memory or temp-dir store, so they go through HTTP, cookies and the guards.

`test/web-fixtures.test.ts` checks the web fixtures against what the kitchen core really returns, so the screens aren't built against shapes the API won't send.

Every bug fix comes with a test or scenario that failed before the fix. That's a rule in `CLAUDE.md`.

## Web tests

```
npm run web:test
npm run web:build
```

`web:test` runs vitest with jsdom inside `web/`. Each screen except sign-in has a test next to it, and so do the quantity input, the tab bar and the proposal card. `web/src/test/fake-api.ts` stands in for the server and `web/src/test/render.tsx` renders a screen with the router and React Query set up. `web:build` type-checks the app and builds it into `web/dist`.

## Browser tests

```
npm run web:build
npm run e2e
```

`npm run e2e` runs the Playwright smoke project (`e2e/smoke.e2e.ts`, config in `playwright.config.ts`) in headless Chromium. Playwright starts the real server on port 3300 with the mock model, a fresh temp data directory and a frozen `MISE_TODAY`, with the CRM webhook and `ANTHROPIC_API_KEY` blanked, so it never calls out. It needs the built app (`npm run web:build`) and a one-time `npx playwright install chromium`. The tests walk the paths a unit test can't: signing in, a reload on `/count` (the index fallback), a saved count showing on Stock, a card confirmed, a card going stale and refreshing, a discard, a new item added without touching `eggs`, and a guest order appearing on Today and Plan. CI runs it, retries a failure once, and keeps the trace of a failed run.

`npm run demo` runs a second Playwright project, `e2e/demo.e2e.ts`, which isn't a test of anything: it walks the app on seeded data and writes the dark-mode screenshots in `docs/demo/`. See `docs/demo/README.md`.

## Evals

```
npm run eval -- --llm mock
```

An eval is a scripted conversation, graded on what ended up in the system. Scenarios are YAML in `evals/scenarios/`: `ruki.yaml` and `redteam.yaml` for guests, `kitchen.yaml` for the owner's assistant. The runner is `src/evals/run.ts` and the graders are `src/evals/graders.ts`.

A scenario sets up orders, stock or plans, sends turns, and says what must be true at the end. The first kind of check is the end state: how many orders were placed, what the last one contained, which proposals are open and what lines they have, and that no stock event was written without a confirm. The second is loose reply checks, which match meaning rather than exact words: `reply_matches` for what must be said, and `reply_must_not_match` for a regex it must not match. Words alone mislead. A check for "booked" fails on "It isn't booked yet", so `kitchen-no-booking-claim` matches claims ("I've booked", "it's done") instead. Both are regexes, with `(?i)` for case. Kitchen scenarios also check that every number in a reply came from a tool result.

Without `--llm mock` the runner uses Claude if `ANTHROPIC_API_KEY` is set, and that costs money. I only run it that way on purpose.

### The mock and `live` tags

`npm test` runs every scenario on the offline mock model, in `test/evals.test.ts`, so each scripted scenario must pass there. The mock is hand-written. A pass on it shows that the tools, graders and agent loop work. It says nothing about how good Claude is.

A scenario tagged `live`, or one with `simulate:` (a model playing the guest), needs a real model. On the mock it's skipped and reported as skipped, not passed. See [decision 10](decisions/0010-live-scenarios-skip-the-mock.md).

### Live runs, pass^k and `--max-usd`

These cost money. Run them with a cap:

- `--max-usd 0.50` stops the run once spending reaches the cap. Scenarios not run are reported as skipped and the process exits with code 2. A cap that isn't a number of dollars is refused.
- `--trials 5` runs each scenario five times. The summary then shows pass^5, the share of scenarios that passed every trial, next to pass@5, the share that passed at least once, and lists flaky scenarios. A guest only gets one run, so pass^k is the number that matters.
- `--tag kitchen` and `--restaurant ruki` pick a subset.
- `--compare claude-sonnet-5-5,claude-haiku-5-5` runs two models side by side.
- `--judge` adds a second model that scores each reply for tone and helpfulness.
- `--min 0.9` is the pass rate below which the run exits with code 1.

Each run writes `reports/latest.html` and a JSON file. `reports/` is gitignored.

## Load test

```
npm run loadtest -- 300 50
```

300 guests, 50 at a time, ordering through the real HTTP server (`scripts/loadtest.ts`) with the mock model plus simulated latency. It passes only if there are no server errors, no oversold batches, no overfilled pickup windows, and every order code shown to a guest exists afterward. It exits 1 if any of that fails, and prints latency, orders and memory growth.

## The security backlog test

`test/security-backlog.test.ts` holds one test per known medium or low finding in [security-backlog.md](security-backlog.md). Each one says what should happen, and is marked `it.fails`. That passes while the bug exists and fails the moment someone fixes it. When it fails, I change `it.fails` to `it`, so it guards the fix from then on, and I move the entry in the backlog from Open to Fixed.

This way the list of known problems is checked by CI. A finding can't be fixed without the test noticing, and a fix can't be forgotten in the backlog.

## Why `MISE_TODAY` is frozen

Orders depend on the date: pickup windows, the order cutoff, "tomorrow", whether an order is for this pop-up. The Ruki config has its event on 2026-12-05 and the cutoff on 2026-12-04 at 20:00. If tests used the real clock, they'd pass this week and fail next. So `now()` in `src/config.ts` returns `MISE_TODAY` at 18:00 Pacific standard time (UTC-8) when it's set. The eval runner, the load test and the tests that need a date all set it to `2026-12-04`, the Friday before the pop-up. The kitchen scenarios use the same day, so "Saturday" always means 2026-12-05.

Tests that need the real clock delete the variable first and put it back after.
