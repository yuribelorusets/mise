# 3. Stock is an append-only event log

November 2026 · Accepted

## Context

Kitchens don't really have "a quantity of eggs". They have deliveries, usage, waste, moves between the walk-in and the line, and counts that correct everything else. A single mutable number loses the history and makes mistakes impossible to trace.

## Decision

Every stock change is an event: `receive`, `use`, `waste`, `count` or `move`, for one item and location, in base units, with where it came from and an optional price. A count sets the amount outright; everything else adds or subtracts. On-hand is worked out from the log, never stored.

## Alternatives

- **A table of current quantities.** Simpler to read, but no audit trail, no "why is this wrong", and no way to compare what should have been used with what was counted.

## Consequences

- On-hand is the last count plus what happened since, which is how kitchens reconcile anyway.
- A negative on-hand isn't clamped. It means a delivery was never logged, and the screen should show that rather than hide it.
- The order events were appended in is the truth.
- It's the same pattern as the preorder ledger, which already replays on startup so a restart can't lose orders.
