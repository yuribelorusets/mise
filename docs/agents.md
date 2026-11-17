# Built with agents

I built the kitchen tool with Claude Code: one main session that plans and merges, and subagents that build, review and triage. This page says who does what, what it cost, what it caught and what wasn't worth it. The decision behind it is [13](decisions/0013-built-with-agents.md). The numbers are from my own notes, measured on the agent runs in November 2026, and they don't include the main session's own context.

## The roster

The definitions are in `.claude/agents/`. Each one gets the fewest tools that do the job and the cheapest model that's good enough.

| Agent | Model | Tools | Why |
|---|---|---|---|
| `builder` | Sonnet | read, search, edit, write, shell | Builds one backend package on its own branch. It has to run tests, so it gets a shell. |
| `frontend-builder` | Sonnet | same | The same job for `web/`. Its definition forbids opening a browser, for the reason under "Mistakes". |
| `reviewer` | Sonnet | read, search, shell | Reads the diff against the project's rules. No edit tools, so it can't change what it reviews. The shell is for `git diff`. |
| `security-reviewer` | Sonnet | read, search, shell, edit, write | Looks for leaks and abuse and proves each finding with a failing test, so it has to write files. By instruction it writes only under `test/`, `evals/` and `docs/security-backlog.md`. |
| `test-writer` | Sonnet | read, search, edit, write, shell | Writes the failing test for a bug before anyone fixes it. |
| `eval-triager` | Sonnet | read, search, shell | Runs evals and sorts failures by cause. Never edits. |
| `explorer` | Haiku | read, search | "Where is X handled." Short answers, so a cheap model is enough, and no shell. |
| `documenter` | Sonnet | read, search, edit, write, shell | Keeps `README.md` and `docs/` true to the code, and runs the commands it documents. |

Only the explorer is on Haiku. Nothing is on the strongest model by default. I tried that twice, and what happened is under "What wasn't worth it".

## How a package gets built and merged

The full protocol is in [the master plan](plans/kitchen-v1.md#branch-and-merge-protocol). In short:

1. The main session, which I call the orchestrator, starts a builder in its own worktree on a feature branch from the current `main`.
2. The builder works through its tasks: failing test, code, passing test, commit. It touches only the files its package owns. If the plan is wrong or it needs a file it doesn't own, it stops and says so instead of working around it.
3. A reviewer and a security reviewer read the branch in parallel.
4. Correctness findings and serious security findings go back to the builder. Medium and low security findings go to [the security backlog](security-backlog.md), each with a test marked `it.fails`.
5. The orchestrator rebases onto `main`, runs the full check, and fast-forwards. After each wave, a security pass reads everything the wave merged.

History stays linear and every commit on `main` passes the tests. In wave 3 the orchestrator also ran typecheck, the web build and both test suites on every commit of a branch with `git rebase --exec`, after folding a fixup in, so no commit in the middle was broken.

## What the runs cost

Tokens are the agent's own. A fix round resumes the builder, so its number includes the first pass's context. Reviews are read-only.

| Run | Tokens | Tool calls | Time |
|---|---|---|---|
| Wave 0: builder removing the phone channel and reservations (3 commits) | 176K | 50 | 5.6 min |
| Wave 0: security review | 88K | 7 | 47 s |
| Wave 0: reviewer | 98K | 12 | 65 s |
| Wave 1: builder, kitchen core (7 commits) | 56K | 39 | 2.2 min |
| Wave 1: reviewer on it | 30K | 7 | 3.0 min |
| Wave 1: security reviewer on it | 24K | 6 | 64 s |
| Wave 2: frontend-builder, screens on live data (9 commits) | 208K | 158 | 13.3 min |
| Wave 2: reviewer on it | 37K | 9 | 49 s |
| Wave 2: documenter, four docs (4 commits) | 103K | 37 | 3.7 min |
| Wave 3: builder, add-item fix (4 commits) | 57K | 72 | 3.4 min |
| Wave 3: reviewer on it | 24K | 7 | 32 s |
| Wave 3: security reviewer on it | 32K | 7 | 47 s |
| Wave 3: frontend-builder, browser tests and demo (6 commits) | 91K | 53 | 7.5 min |

Wave 1 was twelve runs for about 620K tokens: three builders in parallel, a reviewer and a security reviewer on each, and a fix round for each. Wave 2 was nineteen runs for about 1.5M. Builders and the documenter took about 1.1M of that and the ten reviews about 390K. The screens package alone was 430K with its fixes.

Two read-only reviews cost about half of one build. In wave 1, six reviews cost about 150K tokens, roughly one builder's first pass, and every high finding came from them.

## The eval runs against Claude

Wave 3 was the first time I ran the kitchen scenarios against a real model. I set a spend cap for each run first. One trial each, so these are pass rates, not pass^k.

| Model | Cap | Pass | Spend | Tokens | Per scenario |
|---|---|---|---|---|---|
| Haiku (`claude-haiku-5-5`) | $0.25 | 24 of 26 | $0.0231 | 155K in, 13K out | 4.0 s |
| Sonnet (`claude-sonnet-5-5`), after the grader fixes | $1.50 | 25 of 26 | $0.4368, of which $0.0225 was the simulated guest | 159K in, 9.6K out | 5.3 s |

That's about $0.46 of the $1.75 I allowed. All three failures were a grader or a tool output that was missing a number the model had quoted correctly:

- **`kitchen-no-booking-claim`** (Haiku). The check was a substring match on "booked", and it tripped on "It isn't booked yet". I replaced it with `reply_must_not_match` patterns that look for claims ("I've booked", "it's done") and let denials through.
- **`kitchen-shortfall-live`** (Haiku). The reply quoted the egg case size, 180. That's right, but the number came from the catalog in the model's prompt, and the shopping list tool didn't return it, so the check that every number came from a tool result failed. Shopping lines now carry `buyUnitBase` and `buyBase`.
- **`kitchen-cost-per-plate`** (Sonnet). "One order of syrniki (3 pieces) costs $0.99." The 3 is the recipe yield, from the prompt and not from the `cost` tool. The tool now returns the amount in base units, as `base` and `baseUnit`.

In each case I added the number to the tool output or narrowed the pattern. I didn't loosen the rule that numbers in a reply must come from a tool.

One eval-triager looked at the two Haiku failures: 13K tokens, 6 tool calls, 21 seconds. I didn't fan out, because two failures in one group don't pay for several cold starts. The Sonnet failure I triaged myself. Fan-out pays when there are many failures in unrelated groups with long transcripts.

## What the reviews caught

- **Wave 0.** Deleting one business's scenarios had silently dropped the only non-English and refund-handoff coverage, and a renamed test hid it.
- **Wave 1.** Both reviewers found that `explode` had no cycle guard, and that a torn last line in the stock log swallowed the next event. Security found unit names like "constructor" turning amounts into NaN. On the guardrails package they found that the spend cap ignored the simulated guest and the judge, that an empty `MISE_RETAIN_DAYS` would wipe every chat on startup, and that the webhook fallback file kept phone numbers forever, against the privacy notice.
- **Wave 2.** A half-confirmed retry in the kitchen API. "12 kg of flour is unlimited" in the assistant, which came back through the plan's `maxBatch`. Two commits that left the build broken and a stuck stale card on the screens. A stale capacity cache in the plan.
- **Wave 3.** Both reviewers found on their own that the new create route checked ids but not names or aliases. It now answers 409 for a name that's already an item or alias.

The wave passes found what branch reviews couldn't, because those bugs sit where packages meet: deleting a kitchen item breaks Today when a guest order uses it, guest chat and the owner assistant share one daily budget, and an "Eggs!" offer overwrote the `eggs` item. The last is why the server now makes item ids ([decision 14](decisions/0014-the-server-makes-item-ids.md)).

## What the browser checks caught

A review reads code. Opening the app found other things: the assistant strip covered the card's buttons, and the stale message showed twice. Wave 3 added Playwright smoke tests (`npm run e2e`, run in CI), so the main paths are checked in a real browser on every push, and a demo script that records the screenshots in `docs/demo/`. The first demo was a video. It went by too fast to follow, so I dropped it for dark-mode screenshots.

## What wasn't worth it

- **The strongest model for a security pass.** It was thorough, and found two highs where pieces meet (retention against the in-memory store, and the budget env var) that the branch reviews missed. At 117K tokens it cost about four Sonnet reviews. A pass over a whole wave is the one place I'd try it again.
- **The strongest model for mockups.** It stopped at the usage limit after three screens. A Sonnet frontend-builder did the other two in 36K tokens in the same style.
- **Plan agents told to read the codebase first.** Two tries, same result: they read until something stopped them and committed nothing. A plan brief now names a short reading list and asks for a commit after each section.
- **Fan-out for a handful of failures.** One triager is cheaper.

## Mistakes in how I ran it

- **Builders skipped the red step** when the plan gave them both the test and the code. Fix-round briefs now say to watch the test fail first, and that caught tests that couldn't fail: a large-quantity test passed before the fix until it was rewritten.
- **The frontend-builder opened tabs in my browser.** It had no browser tool, so it shelled out to Chrome for screenshots. Its definition now forbids that, and Playwright runs its own headless Chromium.
- **Security reviewers overwrote each other's scratch tests** at a shared path. Each gets its own path now. One proof test hung on a `__proto__` stock event and kept a process at 300% CPU until I killed it, so proofs run with a timeout.
- **Plans missed files.** The wave 3 builder stopped twice for test files that its new required field broke. Stopping was the right call, and the plan's file list was wrong.

## Known limits

- **`test-writer`'s "only `test/` and `evals/`" is an instruction.** A tool list can't restrict paths. A `PreToolUse` hook in `.claude/settings.json` would enforce it, and that's what I'd add first. The commit rule is enforced: `.githooks/commit-msg` rejects `Co-Authored-By` and `Claude-Session` lines, once git is pointed at it with `git config core.hooksPath .githooks`.
- **The mock only proves the plumbing.** `npm test` runs every scripted scenario on the offline mock, which shows the tools, graders and loop work. How well Claude does shows up only in live runs, and I've done one trial of each model. Scenarios that need a real model are tagged `live` and skip on the mock ([decision 10](decisions/0010-live-scenarios-skip-the-mock.md)).
- **Agents don't share memory.** Each starts cold, so anything it needs has to be in its brief, `CLAUDE.md` or a file it reads. Re-reading is also where most of the cost goes.
- **The token numbers are rough.** Resumed runs report cumulative tokens, the main session's own spend isn't counted, and a few runs didn't report tokens at all.
