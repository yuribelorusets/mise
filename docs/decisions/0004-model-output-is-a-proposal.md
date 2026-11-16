# 4. Anything the model produces is a proposal I confirm

November 2026 · Accepted

## Context

The assistant turns "six quarts stock, two cases eggs" into stock changes, and receipt photos will do the same later. Models misread units, guess the wrong item and invent amounts. Writing that straight into stock would make the numbers untrustworthy, and then the tool is useless.

## Decision

The model suggests, the code checks, I confirm. Every input becomes a **proposal**: a list of stock changes. The code checks each line (the item exists, the unit converts, the amount is a real number, the location exists). Nothing is written until I confirm.

A proposal is **stale** when an event newer than the proposal touches one of its items. Then the confirm is refused until I refresh it. Only events for the proposal's own items count: the count screen writes a dozen events in one save, and if every event made every proposal stale I'd learn to tap Refresh without looking. Confirming twice returns the same result and writes nothing new. A discarded proposal stays as a stub so the chat can still say what it was.

## Alternatives

- **Apply automatically with undo.** Faster, but a wrong number is already in the prep list by the time I notice.
- **Stale on any newer event.** Safer on paper, useless in practice for the reason above.

## Consequences

The count screen and forms work without the model, so AI makes entry faster but nothing depends on it. The full lifecycle is task D3 in [the wave 2 plan](../plans/wave-2.md).
