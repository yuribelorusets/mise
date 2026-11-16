---
name: scenario-from-transcript
description: Turn a real Mise conversation (from the JSONL ledger or the admin dashboard) into an anonymized regression eval scenario. Use when a real guest conversation went wrong, or went right in a way worth locking in.
---

# Turning a real conversation into a scenario

## 1. Find the conversation

The ledger is `$DATA_DIR/<restaurant>.jsonl` (locally `data/runtime/ruki.jsonl`). Each line is `{ kind, at, value }`.
- `kind: "turn"` lines hold `value.sessionId`, `value.user` (guest message), `value.reply`, `value.tools` and `value.flags`.
- Collect every turn with one `sessionId`, ordered by `at`.

```bash
grep '"kind":"turn"' data/runtime/ruki.jsonl | grep '<sessionId>'
```

## 2. Anonymize before anything leaves the ledger

The ledger has real names and phone numbers. Never copy them into `evals/`.
- Replace names with a made-up name in the same language: Галина → Ольга, Maya → Jess.
- Replace phone numbers with `510-555-06xx`, the fictional range the scenarios already use.
- Remove addresses, emails, Instagram handles and anything else that identifies a person.
- Keep the guest's wording, language, typos and message boundaries. Those are what make it a real test.

## 3. Decide what "correct" is

Write down in one sentence what a good host would have done. That sentence goes in `notes:`.
If you can't say it in one sentence, the scenario is too big. Split it.

## 4. Write it

Use the `add-eval-scenario` skill for the format. Then:
- Tag it `real` as well as its topic tags.
- Put it in the business's file (`ruki.yaml`), not a new file.
- Grade the outcome with `end_state`, plus the one check that captures what went wrong.
- Real ledgers have real dates. Move them onto the frozen eval calendar (today 2026-12-04, pop-up 2026-12-05).

## 5. Check it fails for the right reason

If it captures a bug, run it against the model it failed on and confirm it fails. Then run the mock gate (see `add-eval-scenario`).
