# Mise v1: the kitchen

November 2026

## Why the change

Mise started as a guest-facing ordering agent for Ruki, my pop-up. It works, it's well tested, and I'm not going to put it in front of customers. What I actually need is a tool for myself: what I have, what I need for the next pop-up, what to prep, what to buy, and what it costs.

That's what *mise en place* means: everything in its place. Every item has an identity, a location, a quantity and an age, and the job is getting messy inputs into that shape.

Restaurant inventory software (MarketMan, xtraCHEF, MarginEdge) solves this for multi-location restaurants for a few hundred dollars a month. Pop-ups, caterers and small kitchens mostly use spreadsheets. Mise is aimed at that gap, starting with one user: me.

## Scope

**In v1**

- Items, units, storage locations, recipes with sub-recipes, production plans
- Stock as an event log: received, used, wasted, counted, moved
- Prep list, shopping list, batch cost and max batch, all derived
- A count screen and a kitchen assistant (chat or dictation) that turn input into proposals I confirm
- A phone-first owner app in React
- Preorders stay, and feed the production plan

**Next (v2)**

- Receipt photos, with item names learned as I confirm them
- Barcodes through Open Food Facts
- Offline counting

**Out**

- Table reservations, the Fennel & Ash demo restaurant and the Twilio phone channel. They don't fit a kitchen tool, and git history keeps them.
- Accounts for other chefs. That needs auth and a real database, covered in the scaling note.
- Consumer and home use, for now. The core would support it later.

## Data model

Things I define, which change rarely:

- **Item**: name, other names it goes by, a base unit (`g`, `ml` or `each`), and conversions for that item (`case = 180 each` for eggs, `qt = 946 ml`, `dozen = 12 each`). Also allergens, an optional par level and an optional shelf life.
- **Location**: walk-in, freezer, dry storage, home fridge.
- **Recipe**: what it makes, how much, and from what. Every recipe makes an item. "Syrniki batter" makes 6 qt of the batter item, which is stocked and counted like flour. "Syrniki" (one order, three pieces) uses batter, sour cream and jam. That's how sub-recipes and prepped components work without special cases.
- **Production plan**: a date and lines like "40 syrniki". Preorders add to it.

Stock is an append-only log. Each event has a kind (`receive`, `use`, `waste`, `count`, `move`), an item, a location, an amount in the base unit, a time, a source (`manual`, `chat`, `receipt`, `preorder`, `production`) and an optional cost. A count sets the amount outright and everything else adds or subtracts, so on-hand is the last count plus the events after it.

Derived, never stored:

- **Requirements**: the plan expanded through recipes into base-unit totals
- **Prep list**: sub-recipes to make, minus prepped stock already on hand
- **Shopping list**: shortfalls, rounded up to the unit I buy in
- **Cost**: from the latest price paid for each item
- **Max batch**: how many of something I can make from what's on hand. This replaces the fixed `quantity: 40` that preorders sell against today.

Definitions are saved to a JSON file, replaced in a single write. Events go in the existing JSONL ledger. Both sit behind a small storage interface so SQLite or Postgres can replace them later.

Code lives in `src/kitchen/`: `units`, `catalog`, `stock`, `recipes`, `plan`, `store`. The REST API is under `/api/kitchen/`. The app and the assistant's tools call the same functions.

## Getting data in

Every input becomes a **proposal**: a list of stock changes. Code checks it (the item exists, the unit converts, the amount is sane), I confirm it, and only then is it written. Nothing the model produces reaches stock directly.

- **Count screen**: pick a location, see items in shelf order, tap or type amounts. No AI. It's the reliable baseline and the fastest way to do a full count.
- **Assistant**: "six quarts stock, two cases eggs" becomes a proposal card (6 qt stock as 5.7 L, 2 cases eggs as 360) with each line editable. Voice uses the phone keyboard's dictation, or the browser's speech recognition where it's available. The Claude API doesn't take audio, and keyboard dictation is free.
- **Receipts (v2)**: a photo becomes structured lines (raw text, guessed item, amount, unit, price, confidence), which go through the same proposal flow. When I match "ORG BNLS CHKN BRST 2/5LB" to chicken breast, that text is saved as another name for the item, so next time code matches it without the model.

If the model is down, the count screen and forms still work. AI speeds up data entry, but nothing depends on it.

## The kitchen assistant

The existing agent loop, with an owner-facing prompt and kitchen tools:

- Read: `on_hand`, `prep_list`, `shopping_list`, `recipe`, `max_batch`, `cost`
- Write, which only return proposals: `propose_stock_changes`, `propose_plan_changes`

Answers like "what am I short for Saturday?" come from tool results, not the model's memory.

## Access

The owner app sits behind a passcode that sets a session cookie, replacing the admin token in the URL. The public preorder page stays open, with its rate limits plus a new cap per phone number.

## Frontend

`web/` holds a Vite + React + TypeScript app. In development Vite passes `/api` through to Express; in production Express serves `web/dist`. That's one process and one deploy. It replaces `public/`.

Owner screens, with a tab bar at the bottom:

1. **Today**: next production date, a prep list I can check off, shortfalls, incoming preorders
2. **Count**: by location, in shelf order
3. **Stock**: on-hand by location, age and expiry flags, history for each item
4. **Recipes**: editor with sub-recipes and yields, cost per batch and per plate
5. **Plan**: production plans by date, with preorders rolled in
6. **Assistant**: chat with proposal cards, also reachable from a button on every screen

`/order` is the public preorder chat, rebuilt in the same app.

React Router for pages, TanStack Query for server data, plain CSS with design variables and a few components of my own. No UI kit. The look is a printed prep sheet rather than a dashboard: high contrast, numbers in aligned columns, tap targets of at least 44 px for wet hands, and a dark mode. A static mockup of Today and Count gets approved before the rest is built.

It installs to the home screen with a manifest and service worker. v1 needs a connection.

## Testing and evals

- **Kitchen core**: unit tests and fast-check properties. Conversions convert back exactly, doubling the plan doubles requirements, a recipe can't contain itself, a count resets on-hand, and the shopping list is never negative.
- **Known answer**: Ruki's real recipes, where 40 orders of syrniki must produce the prep and shopping lists I'd write by hand.
- **Assistant evals** (`evals/scenarios/kitchen.yaml`), graded on end state: proposals with the right items and base-unit amounts, nothing written before confirming, shortfall answers that match the `shopping_list` tool, an offer to create an unknown item instead of guessing, and Russian input.
- **Mock rule**: scenarios that need a real model get a `live` tag and skip the mock. The mock keeps a small set that checks the harness itself. Live scenarios run on Haiku locally, or in CI when an API key is set.
- **Spend cap**: `--max-usd` on the eval runner.
- **Receipts (v2)**: 10–20 of my own receipts with hand-labeled answers, scored on precision, recall and amount accuracy, with pass^k across trials.
- **Frontend**: Vitest and Testing Library for the proposal card, Playwright for sign-in, counting, confirming a proposal and the prep list.
- **CI**: typecheck, unit and property tests, the mock check, Playwright, the load test.

## Security, privacy and robustness

A dedicated reviewer checks every branch before it merges, and does a full pass after each wave. It can only write tests and eval scenarios, so every finding comes with one that fails. High-severity findings block the merge; the rest go to `docs/security-backlog.md`.

What it looks for:

- **Privacy**: personal data in logs and the ledger, how long it's kept, keeping only what's needed. Receipts show card digits, loyalty numbers and store locations, so those are removed before storage, and raw photos aren't kept by default.
- **Security**: sign-in on owner routes, cookie settings, forged cross-site requests, upload checks (type, size, decompression bombs), rate and spend limits on image extraction, secrets kept out of the browser and logs.
- **Prompt injection**: instructions hidden in a receipt or chat, a proposal that adds items I didn't mention.
- **Robustness**: zero, negative and huge amounts, units that don't match, confirming a proposal twice, a proposal made stale by a newer count, recipe cycles, two confirms at the same moment.

## How it gets built

| Agent | Model | Role |
|---|---|---|
| orchestrator (main session) | Opus | Design, shared interfaces, combining branches, merges, commit messages |
| builder | Sonnet | One work package in its own worktree, test first, small commits, only its assigned files |
| frontend-builder | Sonnet | The same for `web/` |
| test-writer | Sonnet | Failing tests for bugs and rules |
| reviewer | Sonnet | Correctness and Mise's rules |
| security-reviewer | Sonnet | Privacy, security, robustness |
| eval-triager | Sonnet | Runs evals and sorts failures |
| explorer | Haiku | Lookups |

Each work package gets a `feat/<name>` branch in its own worktree. The builder commits there in small steps. The reviewer and security reviewer read the branch in parallel, findings get fixed, then the orchestrator rebases onto `main`, runs CI locally, fast-forwards and pushes. No two agents write the same files.

**Wave 0** (orchestrator, in order): this spec and the plan; remove reservations, the phone channel and Fennel & Ash; add the new agent definitions; write the kitchen interfaces (types, storage interface, route signatures); a minimal `web/` served by Express.

**Wave 1** (in parallel)
- A. Kitchen core
- B. Frontend shell, plus the Today and Count mockup, which waits for my approval
- C. Guardrails and eval tooling: per-phone preorder cap, data retention, privacy notice, `live` tag, `--max-usd`

**Wave 2**
- D. Kitchen API and owner sign-in (after A)
- E. Assistant tools, prompt and `kitchen.yaml` (after A)
- F. Screens wired to the API (after B and D)
- G. Preorders feeding the plan, and max batch replacing fixed stock

**Wave 3**: Playwright in CI, an eval run on Haiku then Sonnet under a spend cap, the scaling note, `docs/agents.md`, the README rewrite.

**Usage**: at most three builders at a time. Model spend for v1 should stay under about $2, backed by `--max-usd` and a $5 Console limit.

## Open inputs

- Ruki's real recipes and yields: syrniki, nalysnyky, the schmears
- Approval of the Today and Count mockup
- Decisions on any high-severity security finding
- Later: 10–20 receipt photos for the v2 eval set
