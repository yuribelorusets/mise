# Mise

AI kitchen tool for the Ruki pop-up, with guest preorders. TypeScript, Express, vitest.

## Commands

- `npm test` runs unit tests and the full eval suite on the offline mock model
- `npm run typecheck`
- `npm run eval -- --llm mock` runs evals offline; without `--llm mock` it uses Claude and costs money
- `npm run loadtest -- 300 50`

## Rules

- Business rules live in code, not the prompt: `src/kitchen/` for stock, recipes and units, `src/domain/restaurant.ts` and `src/agent/tools.ts` for preorders.
- Every bug fix comes with a test or eval scenario that failed before the fix.
- Every scripted scenario in `evals/scenarios/` must pass on the mock, because `test/evals.test.ts` runs them in CI. Scenarios tagged `live` need a real model and skip the mock.
- Evals freeze "today" to 2026-12-04 (`MISE_TODAY`).
- Keep diffs small: one concern per change.

## Commits and docs

- Commit each logical change on its own, when it's done. No catch-all commits.
- Subject: short, imperative, plain ("Reject orders for zero items"). Add a body only when the reason isn't obvious, and keep it to a sentence or two.
- No bullet-list bodies, test counts or summary lines.
- If a change alters behavior described in `docs/` or the README, say which doc in your report. The documenter agent updates docs after each wave.
- A new design decision gets a record in `docs/decisions/`.
- Docs read like a person wrote them: plain and specific, no marketing tone.
- No `Co-Authored-By` or `Claude-Session` lines. Claude is credited once, in the README. The `.githooks/commit-msg` hook enforces this.
