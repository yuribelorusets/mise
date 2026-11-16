# 10. Scenarios that need a real model skip the mock

November 2026 · Accepted

## Context

CI runs the eval suite on a hand-written mock model so it costs nothing. Every scripted scenario had to pass on it, which meant every new phrase needed new mock code, and the mock was passing scenarios it had been tuned to pass. A 100% pass rate on the mock said nothing about quality.

## Decision

Scenarios tagged `live` need a real model and are skipped on the mock. The mock keeps a small set that checks the harness, tools and graders still work. Live scenarios run against Claude, on Haiku first, with `--max-usd` capping the spend. Results report pass^k: the share of scenarios that pass on every one of k runs, because a guest only gets one.

## Consequences

CI proves the plumbing; quality numbers come from real runs and say which model they came from. Checks grade what ended up in the system (orders, items, totals) first and keep reply wording loose, after Sonnet failed two checks that were only tuned to the mock's phrasing.
