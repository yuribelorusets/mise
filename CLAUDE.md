# Mise

AI ordering agent for a pop-up (Ruki) and a demo restaurant (Fennel & Ash). TypeScript, Express, vitest.

## Commands

- `npm test` runs unit tests and the full eval suite on the offline mock model
- `npm run typecheck`
- `npm run eval -- --llm mock` runs evals offline; without `--llm mock` it uses Claude and costs money
- `npm run loadtest -- 300 50`

## Rules

- Business rules (stock, windows, idempotency, date checks) live in `src/agent/tools.ts` and `src/domain/restaurant.ts`, not in the prompt.
- Every bug fix comes with a test or eval scenario that failed before the fix.
- Every scripted scenario in `evals/scenarios/` must pass on the mock, because `test/evals.test.ts` runs them in CI.
- Evals freeze "today" to 2026-12-04 (`MISE_TODAY`).
- Keep diffs small: one concern per change.

## Commits and docs

- Commit each logical change on its own, when it's done. No catch-all commits.
- Subject: short, imperative, plain ("Reject orders for zero items"). Add a body only when the reason isn't obvious, and keep it to a sentence or two.
- No bullet-list bodies, test counts or summary lines.
- Docs read like a person wrote them: plain and specific, no marketing tone.
- No `Co-Authored-By` or `Claude-Session` lines. Claude is credited once, in the README. The `.githooks/commit-msg` hook enforces this.
