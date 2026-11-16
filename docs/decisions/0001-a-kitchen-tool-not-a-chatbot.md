# 1. A kitchen tool, not a guest chatbot

November 2026 · Accepted

## Context

Mise started as an AI host for Ruki, my pop-up: it took preorders over chat and the phone, booked tables for a demo restaurant, and answered allergy questions. It was well tested, but I was never going to put it in front of customers. What I actually lacked was a way to know what I have, what the next pop-up needs, what to prep and what to buy.

Restaurant inventory software (MarketMan, xtraCHEF, MarginEdge) does this for multi-location restaurants at a few hundred dollars a month, with heavy setup. Pop-ups, caterers and small kitchens mostly use spreadsheets and memory.

## Decision

Mise is a tool for the chef-owner: items, locations, stock as events, recipes, production plans, and the prep list, shopping list, cost and max batch worked out from them. Guest preorders stay, as one source of demand for the plan. Table reservations, the demo restaurant and the phone channel are removed.

## Alternatives

- **Keep the guest chatbot as the product.** It has no real user, so it would stay a demo.
- **A home pantry app** (fridge photo, recipes). The App Store is full of these, and it isn't where my experience is.
- **Build on Grocy**, the open-source home inventory app, with Mise as the AI layer. Less to build, but it splits the data and makes someone else's model the core.

## Consequences

The agent loop, the rules-in-code approach, the event log and the eval harness carry over, pointed at the kitchen instead of guests. The removal is wave 0 in [the build plan](../plans/kitchen-v1.md). The design is in [the v1 spec](../design/kitchen-v1.md).
