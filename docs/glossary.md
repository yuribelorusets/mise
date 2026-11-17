# Glossary

The words I use in the kitchen and on the screens, and the names they have in the code. Types are in `src/kitchen/types.ts` unless noted.

**Item** (`Item`). Anything I count: eggs, flour, syrniki. It has a name, a few aliases, a base unit and its own units. Syrniki are an item too, the made one. Every recipe makes an item ([decision 5](decisions/0005-every-recipe-makes-an-item.md)).

**Base unit** (`BaseUnit`). What an item is stored in: `g`, `ml` or `each`. All stock is kept in base units. Converting from what I said ("2 cases") is `toBase` in `src/kitchen/units.ts`.

**Own unit** (`Item.units`). A unit that only that item has, written in base units: a case of eggs is 180 `each`, one order of syrniki is 3 `each`. Global units like kg, cup and dozen need no entry.

**Location** (`Location`). A place stock is kept: the walk-in, the line. Each location lists its items in shelf order, which is the order the Count screen shows them.

**Stock event** (`StockEvent`). One line in the stock log: receive, use, waste, count or move, for one item and location, in base units. On-hand is worked out from the log and never stored ([decision 3](decisions/0003-stock-is-an-event-log.md)). The code is in `src/kitchen/stock.ts`.

**Count** (`kind: "count"`). I looked at the shelf and this is how much there is. It sets the amount outright, which corrects every event before it. The Count screen writes these.

**Receive, use, waste, move.** A delivery adds. Use and waste subtract. A move takes from one location and adds to another. A receive can carry the price paid, which is where costs come from.

**Par** (`Item.par`). How much of an item I want to have, in base units. Stock shows "below par" when the total across locations is under it.

**Recipe** (`Recipe`). Components and a yield. One batch of the recipe makes the yield of one item. A component can itself be an item that has a recipe, like a dough, and that is how sub-recipes work.

**Yield** (`Recipe.yield`). What one batch makes, such as 40 orders.

**Plan** (`ProductionPlan`). What to make on one date. It's a list of plan lines.

**Plan line** (`PlanLine`). One item, an amount and a unit, with a `source`: `manual` (I typed it) or `preorder` (rolled in from guest orders). Preorder lines are never saved with the plan.

**Explode** (`explode` in `src/kitchen/plan.ts`). Turning plan lines into work: use what's on hand first, make the rest from recipes, and buy what has no recipe. It returns the prep list and the shopping list.

**Prep** (`PrepTask`). A recipe to make and how many batches. This is the list on Today.

**Shopping, Short** (`ShoppingLine`). What I have to buy after using stock: how much is needed, how much is on hand, how much is short. The Today screen calls it Short. The buy amount is rounded up to the item's biggest own unit, so eggs come out in cases. A line rounded to a case also says what the case is and what the buy comes to in base units (`buyUnitBase`, `buyBase`): 2 cases of eggs is `buyBase` 360.

**Netting.** Taking what's on hand off what a plan needs before deciding what to make or buy. In `explode`, stock is used first, and a sub-recipe's own stock is used before it makes more of it.

**Max batch** (`maxBatch` in `src/kitchen/cost.ts`). The most whole units of an item I can make from current stock, going down through sub-recipes. When stock isn't the limit it comes back as `Infinity` in code and `null` from the API and the assistant.

**Cost** (`batchCost`). What a batch costs at the latest price paid for each ingredient. An ingredient with no price yet is listed as missing and left out, so the figure is a floor.

**Proposal** (`Proposal`, `ProposalView`). A list of suggested stock changes from the assistant, waiting for me. Nothing is written until I confirm ([decision 4](decisions/0004-model-output-is-a-proposal.md)). It's shown as a card. The code is `src/kitchen/proposals.ts`.

**Book** (`ProposalBook.confirm`). Confirming a proposal writes its lines to the stock log as events. "Booked" means they're in the log. "Book" is also the name of the class that holds proposals, `ProposalBook`.

**Stale.** A proposal is stale when stock changed for one of its items after the proposal was made, by something other than the proposal itself. A stale proposal can't be confirmed until I refresh it. The rule is `isStale` in `src/kitchen/proposals.ts`, and it works off `basedOn`, the length of the stock log when the proposal was made.

**Refresh.** Telling a stale proposal "I've seen the new stock, it still stands". It moves `basedOn` forward. It doesn't change the lines.

**Offer** (`NewItemOffer`). The assistant's suggestion to add an item it doesn't know. It's a button, and nothing is added until I tap it.

**Assistant.** The owner's chat in `src/kitchen/assistant/`. Not the guest agent in `src/agent/`.

**Menu item** (`MenuItem` in `src/domain/restaurant.ts`). What a guest can order, with a price and a limited `quantity`. Separate from a kitchen item: the menu item "Syrniki" and the kitchen item `syrniki` are linked by `makes`.

**`makes`** (`MenuItem.makes`). On a menu item, the kitchen item and unit it turns into: `{ "item": "syrniki", "unit": "order" }`. Preorders use it to become plan lines, and selling from stock uses it to find the limit. The server refuses to start if it names an item or unit that doesn't exist. Not to be confused with `Recipe.makes`, which is the item a recipe produces.

**Order.** One order of syrniki is three pieces. Order quantities from guests are always orders, not pieces ([decision 9](decisions/0009-quantities-are-orders.md)). Don't confuse it with a guest's order (`Order`), the whole preorder with name, phone, items and pickup time.

**Preorder.** A guest's `Order` for a pickup date. Preorders add `preorder` lines to that date's plan through `src/kitchen/preorders.ts`.

**Pickup window.** One of the times a guest can collect, each with a cap of orders (`ordersPerWindow`).

**Cutoff** (`popup.orderCutoff`). The time guests stop being able to order.

**Selling from stock** (`popup.sellFromStock`). Off by default. When on, a menu item with `makes` is also limited by what the kitchen can make from stock, after setting aside the day's plan ([decision 12](decisions/0012-preorders-and-stock.md)).

**Capacity** (`orderCapacity` in `src/kitchen/preorders.ts`). How many more orders of a menu item stock can cover once the plan is set aside. It's what selling from stock uses.

**Owner.** Me. I sign in with the passcode ([decision 11](decisions/0011-owner-sign-in.md)). Guests never sign in.

**Ledger** (`src/ops/ledger.ts`). The log of guest orders and chat turns, with what each turn cost. Not the stock log.

**`MISE_TODAY`.** An environment variable that freezes "today" for tests and evals. See [testing](testing.md).
