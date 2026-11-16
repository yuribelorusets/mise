# Security backlog

Medium and low findings from the security reviewer that didn't block a merge. High findings are fixed before merging and don't land here.

## Open

- **[low] A config without `popup` fails late.** `popup` is required by the type, but `loadRestaurant` doesn't check the JSON, so a hand-edited config missing it loads fine and then throws at the first `place_order`. It should fail at startup with a clear message. Found reviewing `feat/cleanup` (wave 0). Test to add in `test/robustness.test.ts`: loading a config with `popup` removed throws `/popup/`.

## Covered elsewhere

- **[low] Old reservation lines keep names and phones on disk.** Replay skips them, but they stay in old ledger files. Wave 1 task C2 (`Ledger.compact`) rewrites the ledger from the entries it keeps, so these lines go the first time it runs.
