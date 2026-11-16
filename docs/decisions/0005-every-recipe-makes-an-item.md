# 5. Every recipe makes an item

November 2026 · Accepted

## Context

Kitchen recipes nest: syrniki need batter, batter needs farmer's cheese and eggs. And prepped components are stock too. Batter made on Friday is counted on Saturday like flour.

## Decision

A recipe always makes exactly one item, with a yield. "Syrniki batter" makes 2 kg of the batter item; "syrniki" makes one order from 150 g of batter, sour cream and jam. A production plan is expanded through the recipes the way material planning software does it ("netting"): use what's on hand first, turn the rest into prep tasks, and push what's still missing down to the ingredients. Stock is shared across plan lines, so two lines can't both use the same batter.

## Alternatives

- **A separate type for prepped components.** Two kinds of thing to count, store and plan, for no gain.

## Consequences

Sub-recipes, prepped stock and the prep list fall out of one rule. Max batch ("how many orders can I make from what's here?") is the same calculation searched in reverse. A recipe that contains itself is rejected when the catalog is checked.
