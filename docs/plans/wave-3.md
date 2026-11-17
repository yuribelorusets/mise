# Wave 3: a safe Add item, browser tests and a demo, live evals, docs

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to work through this task by task. Steps use checkboxes (`- [ ]`).

**Goal:** Fix the one bug that can lose catalog data, put real browser tests in CI, record screenshots and a screencast of the key features for demos, run the evals against Claude for the first time under a spend cap, and write the docs that explain the project to someone new.

**Architecture:** Package I changes how the assistant's new-item offer becomes a catalog record: the server works out the id and only ever creates. Package H adds Playwright (headless Chromium) with a smoke suite that runs in CI and a separate demo script that writes screenshots and a video to `docs/demo/`. Package J is the orchestrator running the eval suite on Haiku, then Sonnet, with eval-triager agents sorting the failures. Package K is the documenter writing the scaling note, `docs/agents.md` and the README.

**Tech stack:** TypeScript, Express 5, vitest (I). Playwright test runner with Chromium (H). The eval runner in `src/evals/run.ts` (J).

**Spec:** [docs/design/kitchen-v1.md](../design/kitchen-v1.md) · **Master plan:** [kitchen-v1.md](kitchen-v1.md) · **Built on:** `main` at `7cd7916`, after wave 2

## Global constraints

The master plan's constraints and `CLAUDE.md` apply. In addition:
- Order: I first, alone. H starts once I is merged. J can run while H is open, because it changes no files unless a triage turns up a real bug, and those fixes go through the orchestrator one at a time. K starts once H and J are done, because it uses their screenshots and numbers.
- Builders and reviewers run on Sonnet. No Fable.
- **Never call Claude except in package J**, and only after the owner has named the `--max-usd` cap. Everything else runs evals with `--llm mock`.
- **Browsers:** Playwright drives its own headless Chromium. No agent opens the owner's browser, runs `open`, or starts anything on port 5173. The orchestrator still looks at the demo output itself before showing the owner.
- The kitchen API, proposal lifecycle and assistant behave as wave 2 left them. `src/kitchen/types.ts` changes only in I1, for the one field below.
- Backlog entries this wave closes: the offered-id overwrite (medium) and the empty id for Russian names (low), both found in the wave-2 pass. H also fixes a new one: the index fallback 404s when the app runs from a path containing a dot directory (`sendFile` refuses dot segments by default), which is why the app can't be served from a `.claude/worktrees/` checkout.

---

## Package I: Add item can't overwrite an item

**Branch:** `feat/safe-add-item` · **Agent:** builder · **Owns:** `src/kitchen/types.ts` (`NewItemOffer.id` only), `src/kitchen/catalog.ts`, `src/kitchen/assistant/tools.ts`, `src/kitchen/api.ts`, `web/src/pages/Assistant.tsx`, `web/src/api/hooks.ts`, `test/kitchen/catalog.test.ts`, `test/kitchen/assistant/tools.test.ts`, `test/kitchen/api.test.ts`, `test/security-backlog.test.ts`, `web/src/pages/Assistant.test.tsx`

What goes wrong today. When the assistant meets a name it doesn't know, `offer_new_item` checks the name against the catalog (exact id, then `findItem`) and the card shows an Add button. The button makes the id itself, with `slug()` in `Assistant.tsx` (`name.toLowerCase().replace(/[^a-z0-9]+/g, "-")`), and posts the record to `POST /api/kitchen/catalog/items`, which replaces any record with that id. So "Eggs!" passes the name check, slugs to `eggs`, and tapping Add replaces the real `eggs` item, dropping its aliases, units and allergens. A Russian name ("Сумах") slugs to an empty id, which the route refuses, so Add never works for it.

The fix: one function makes the id, the tool refuses an offer whose id is taken or empty, the offer carries its id to the screen, and the screen creates through a route that never replaces.

### Task I1: One place that turns a name into an id

**Files:** `src/kitchen/catalog.ts`, `src/kitchen/types.ts`. Test: `test/kitchen/catalog.test.ts`.

- [ ] **Step 1: Failing tests** for a new export `itemIdFor(name: string): string`:
  - `"Eggs!"` gives `"eggs"`, and `"Sour cream (20%)"` gives `"sour-cream-20"`.
  - Russian is transliterated, not dropped: `"Сумах"` gives `"sumakh"`, and `"Творог 9%"` gives `"tvorog-9"`. Use a small fixed table for the Russian alphabet (ё as e, й as i, ъ and ь dropped, ж zh, х kh, ц ts, ч ch, ш sh, щ shch, ю yu, я ya). No new dependency.
  - A name with nothing usable (`"!!!"`, `"🥚"`) gives `""`.
  - The result always matches the id pattern `validateCatalog` already enforces, or is `""`.
- [ ] **Step 2:** Run them and watch them fail (the export doesn't exist).
- [ ] **Step 3:** Implement. Add `id: string` to `NewItemOffer` in `src/kitchen/types.ts`, with a one-line comment: "What the item will be saved as. Worked out by the server, never by the screen."
- [ ] **Step 4:** `npm run typecheck && npm test`, then commit: `Turn item names into ids in one place, Russian included`

### Task I2: The tool refuses an offer it can't add

**Files:** `src/kitchen/assistant/tools.ts`. Tests: `test/kitchen/assistant/tools.test.ts`, `test/security-backlog.test.ts`.

- [ ] **Step 1:** In `test/security-backlog.test.ts`, flip the two wave-2 `it.fails` ("doesn't offer a new item whose id is an existing item's id" and "doesn't offer a new item whose id would be empty") to `it`. Add to `tools.test.ts`: an offer for "Сумах" succeeds with `id: "sumakh"` in `ctx.offers`; an offer whose id matches an existing item's id fails with a message that names the existing item, the same way a found name does; two offers in one turn with the same id ("Eggs?" and "eggs!") fail on the second.
- [ ] **Step 2:** Run and watch them fail.
- [ ] **Step 3:** In `offer()`, compute `id = itemIdFor(name)`. Refuse it when it's empty ("I can't make an id from that name. Ask the owner to name it in letters or digits."), when an item already has that id, or when an earlier offer this turn has it. Put `id` on the offer.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run eval -- --llm mock --max-usd 0.01`, then commit: `Refuse a new-item offer whose id is taken or empty`

### Task I3: Adding an item only creates

**Files:** `src/kitchen/api.ts`, `web/src/api/hooks.ts`, `web/src/pages/Assistant.tsx`. Tests: `test/kitchen/api.test.ts`, `web/src/pages/Assistant.test.tsx`.

- [ ] **Step 1: Failing tests.**
  - API: `POST /api/kitchen/items` with `{ name, baseUnit }` creates `{ id: itemIdFor(name), name, aliases: [], baseUnit, units: {}, allergens: [] }` and answers 201 with the new item. It answers 409 when the id exists (the catalog is unchanged), 422 when the name gives an empty id or the base unit isn't g, ml or each, and 401 when signed out. It takes no `id` from the body.
  - Web: tapping Add on an offer calls the new route with the offer's name and base unit, and never posts to `/catalog/items`. A 409 shows "That's already in the catalog as …" on the card, not a crash.
- [ ] **Step 2:** Run and watch them fail.
- [ ] **Step 3:** Add the route, next to the catalog routes and behind the same owner check. Add a `useAddItem()` hook that invalidates `keys.catalog`. In `Assistant.tsx`, delete `slug()` and use the hook. `POST /catalog/items` keeps its replace behaviour for the Recipes and Plan screens.
- [ ] **Step 4:** `npm run typecheck && npm test && npm run web:test && npm run web:build`, then commit: `Add offered items through a route that never replaces one`

**Report:** the commits, the check summaries, and confirmation that the two backlog tests are now plain `it`.

---

## Package H: Playwright smoke tests and a demo recording

**Branch:** `feat/browser-tests` · **Agent:** frontend-builder · **Starts after:** I is merged · **Owns:** `e2e/**` (new), `playwright.config.ts` (new), `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, `.gitignore`, `docs/demo/**` (new), `src/server.ts` (the index fallback's `sendFile` call only), `test/server.test.ts`

### Task H1: Serve the app from any path

**Files:** `src/server.ts`, `test/server.test.ts`.

- [ ] **Step 1:** Failing test: with `webDist` pointing at a temp directory whose path contains a dot directory (`<tmp>/.hidden/dist/index.html`), `GET /count` answers 200 with the index page. Today it's 404 because `res.sendFile` refuses dot segments.
- [ ] **Step 2:** Watch it fail. Fix it with `res.sendFile("index.html", { root: webDist, dotfiles: "allow" })`. `root` keeps the path fixed, so nothing outside `webDist` can be served.
- [ ] **Step 3:** `npm run typecheck && npm test`, then commit: `Serve the app's index page from a path with a dot directory`

### Task H2: Playwright and a server for it

**Files:** `package.json`, `package-lock.json`, `playwright.config.ts`, `e2e/fixtures.ts`, `.gitignore`.

- [ ] `npm i -D @playwright/test` (pin the version), then `npx playwright install chromium`. Scripts: `"e2e": "playwright test --project=smoke"` and `"demo": "playwright test --project=demo"`.
- [ ] `playwright.config.ts`: `webServer` builds nothing (CI runs `web:build` first). It runs `npx tsx src/server.ts` with `PORT=3300`, `MISE_LLM=mock`, `MISE_RESTAURANT=ruki`, `MISE_TODAY=2026-12-04`, a fresh `DATA_DIR` under the OS temp directory, and `MISE_OWNER_PASSCODE` set to the test passcode exported from `e2e/fixtures.ts` (a fixed test-only value, at least 8 characters, used nowhere else). Use `reuseExistingServer: false`. Two projects: `smoke` (viewport 375×812, headless, retries 1 in CI) and `demo` (described in H4).
- [ ] `e2e/fixtures.ts`: `signIn(page)`, and `seed(request)` that signs in through the API and posts the plan `popup-2026-12-05` (40 orders of syrniki) plus counts for the walk-in and dry storage, the same data the orchestrator used to check wave 2 by hand.
- [ ] `.gitignore`: `test-results/`, `playwright-report/`, `demo/raw/`.
- [ ] Commit: `Add Playwright with a mock-model server for browser tests`

### Task H3: The smoke suite

**Files:** `e2e/smoke.spec.ts`.

Each test signs in fresh and seeds what it needs. Assert on visible text and roles, not CSS classes.
- [ ] Signed out, `/` shows the sign-in screen. A wrong passcode shows an error. The right one shows Today.
- [ ] Reloading `/count` returns the app, and `/order` loads without signing in.
- [ ] Today shows the plan date, the prep list and the Short table from the seeded data.
- [ ] Count: change eggs and save. Stock then shows the new amount without a reload.
- [ ] Assistant: "received 2 cases of eggs" gives a card. Confirm turns it into Booked, and Stock shows 360 more eggs.
- [ ] Stale: make an eggs card, post an eggs count through the API, and tap Confirm. The card shows Stale with one message. Refresh then Confirm books it.
- [ ] Discard leaves a "Discarded" stub.
- [ ] Add item: "received 3 kg sumac" gives an offer. Tap Add, and the item appears in the catalog with id `sumac`, while `eggs` keeps its units. The id clash itself is covered by I's unit tests.
- [ ] `/order`: a mock guest order for syrniki shows a confirmation, Today lists it under Preorders, and Plan shows a preorder line that can't be edited.
- [ ] `npm run e2e` passes twice in a row locally. Commit: `Add browser smoke tests for sign-in, counts, proposals and preorders`

### Task H4: Demo screenshots and screencast

**Files:** `e2e/demo.spec.ts`, `docs/demo/**`, `playwright.config.ts` (the `demo` project).

For demos and the README. Not part of CI.
- [ ] The `demo` project: headless Chromium, `video: { mode: "on", size: { width: 390, height: 844 } }`, `viewport` 390×844, `launchOptions.slowMo` about 250 ms so the video is watchable, and `outputDir: "demo/raw"`.
- [ ] `e2e/demo.spec.ts` is one continuous walkthrough on seeded data, pausing about a second on each screen:
  1. Sign in.
  2. Today: prep list, Short and Preorders.
  3. Count: change two rows and save.
  4. Assistant: "received 2 cases of eggs" → card → Confirm → Booked.
  5. A stale card → Refresh → Confirm.
  6. A new-item offer → Add.
  7. Stock showing the changes.
  8. Recipes with a cost.
  9. Plan with the preorder line.
  10. `/order`: menu, privacy notice, and a guest order placed in chat.
  11. Back to Today with the new preorder.
- [ ] Screenshots, with `page.screenshot`, saved as `docs/demo/<nn>-<screen>-mobile.png` at 390×844. Also take desktop versions (1280×800) of Today, Assistant, Plan and `/order` as `docs/demo/<nn>-<screen>-desktop.png`.
- [ ] After the run, copy the video to `docs/demo/mise-walkthrough.webm`. If it's over 10 MB, lower the size or the slowMo until it fits. Don't commit anything from `demo/raw/`.
- [ ] `docs/demo/README.md`: one line per file saying what it shows, and how to regenerate them (`npm run web:build && npm run demo`).
- [ ] Commit the script first (`Add a scripted demo walkthrough`), then the output (`Add demo screenshots and a walkthrough video`).

### Task H5: Browser tests in CI

**Files:** `.github/workflows/ci.yml`.

- [ ] After `npm run web:build`, add `npx playwright install --with-deps chromium` and `npm run e2e`. On failure, upload `playwright-report/` as an artifact.
- [ ] Commit: `Run the browser smoke tests in CI`

**Report:** the commits, `npm run e2e` output, the list of files in `docs/demo/` with sizes, and anything that differed from the approved screens while recording.

---

## Package J: The evals against Claude (orchestrator)

**Who:** the orchestrator, in the main checkout (the worktrees have no `.env`), with eval-triager agents on Sonnet. **Starts after:** I is merged and the owner has named the cap.

- [ ] **Owner checkpoint:** ask for the `--max-usd` amount for each run. Don't run anything against Claude before the answer.
- [ ] Haiku first: `npm run eval -- --llm anthropic --model claude-haiku-5-5 --max-usd <cap>`. Save the summary and `reports/latest.json` path in the status file.
- [ ] Group the failures (for example kitchen, popup, multilingual, safety) and run one eval-triager per group, in parallel, on that run's transcripts only. Each sorts its failures into tool bug, prompt, grader, scenario or flaky.
- [ ] Show the owner the buckets. Real bugs go through the usual loop: test-writer writes a failing test or scenario, a builder fixes it on its own branch, review, merge, one at a time.
- [ ] Then Sonnet: `npm run eval -- --llm anthropic --model claude-sonnet-5-5 --max-usd <cap>`. Triage only what's new.
- [ ] Record each run's pass rate, spend and tokens in `notes/agent-workflow.md`, for K.

---

## Package K: Scaling note, `docs/agents.md`, README

**Branch:** `docs/wave-3` · **Agent:** documenter · **Starts after:** H and J · **Owns:** `README.md`, `docs/agents.md` (new), `docs/design/scaling.md` (new)

- [ ] `docs/design/scaling.md`: what changes past one kitchen, one owner and one process. That covers the file store and ledger (one process per data dir), in-memory sessions, a database, accounts, and several kitchens per server. Link decisions 6 and 11. Say what I'd do first, and why it isn't needed yet.
- [ ] `docs/agents.md`: how Mise was built with agents. It covers the roster and why each agent has its model and tools, the orchestrator's branch and merge protocol, and the measured cost per run from `notes/agent-workflow.md` (copy the numbers, not the private notes). It also says what the reviews and the browser checks caught, what wasn't worth it, and the known limits. The eval runs from J go here too, with their spend.
- [ ] README rewrite around the kitchen tool: what it is, for whom, the screens (with a few images from `docs/demo/` and a link to the walkthrough video), how to run it (passcode, `.env`, mock vs Claude), and links to the docs. Claude is credited once, here.
- [ ] One commit per file. Verify every claim against the code. No counts that go stale.
- [ ] The reviewer reads all three for accuracy before merge.

---

## Done when

- I, H and K are merged following the master plan's protocol, with reviewer and security-reviewer findings handled, and J's runs done with the triage findings fixed or in the backlog.
- `npm run typecheck && npm test && npm run loadtest -- 300 50 && npm run web:build && npm run web:test && npm run e2e` passes on `main`, and so does CI on GitHub.
- The two wave-2 backlog tests for Add item are plain `it`, and their entries are under "Fixed".
- `docs/demo/` has the mobile and desktop screenshots and a walkthrough video under 10 MB, and the owner has seen them.
- `docs/agents.md`, `docs/design/scaling.md` and the new README are merged, and the README shows the demo images.
- Total model spend for J stays within the caps the owner set.

## Owner checkpoints

- **Before J:** the `--max-usd` cap for the Haiku run and for the Sonnet run.
- **After H4:** look at the screenshots and the video before the README uses them.
- **After J's Haiku triage:** which failures to fix now and which go to the backlog.
- **Before K merges:** read the README.
- Any high-severity security finding.
