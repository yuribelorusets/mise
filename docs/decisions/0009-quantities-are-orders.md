# 9. Quantities are orders, not pieces

November 2026 · Accepted

## Context

The first eval run against Claude (Haiku) failed two Russian preorders. "2 сырники" naturally means two pancakes, but syrniki are sold three to an order, and the only place that said so was a free-text description. Claude noticed the mismatch and kept asking instead of ordering. The English version of the same request passed because the model assumed orders. The offline mock had passed both, because I wrote it to.

## Decision

Pieces per order is structured data on the item, returned by the menu search. Order quantities are always orders. If it's unclear which a guest means, the agent asks once, in the same message as anything else it needs. If the guest doesn't say, it goes with orders and spells it out ("2 orders, 6 syrniki, $24").

## Consequences

The same request is now read the same way in both languages. The simulated-guest scenario counts pancakes the way Ruki's regulars do. It's also the clearest example of why the evals need a real model (see [10](0010-live-scenarios-skip-the-mock.md)).
