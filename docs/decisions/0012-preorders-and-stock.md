# 12. Preorders feed the plan, and selling from stock is opt-in

November 2026 · Accepted

## Context

Guest preorders are demand: 40 syrniki ordered means 40 on the production plan. Max batch can also say how many the kitchen can actually make from what's on hand, which could cap what guests can order.

## Decision

Preorders become lines on the production plan automatically. Selling from stock is off by default (`popup.sellFromStock: false`): guests can order up to the menu quantity even before the week's delivery is logged. Turning it on adds the stock limit. In this wave the assistant proposes stock changes only, not plan changes.

## Alternatives

- **Always cap preorders by stock.** Correct once stock is logged reliably, but early in the week, before deliveries are in, it would stop all orders.

## Consequences

The guest side and the kitchen side share one plan. Max batch says when stock doesn't limit a dish at all, instead of returning its search limit as if it were a real number.
