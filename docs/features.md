# Features

What works today, screen by screen. For how the pieces fit, see [architecture](architecture.md). For the words, see the [glossary](glossary.md).

The owner screens live in `web/src/pages/`. Each one except sign-in has a test next to it (`Today.test.tsx` and so on), and the server side is tested under `test/` and `test/kitchen/`. The main paths (sign-in, a count, a card confirmed, stale and refreshed, a new item added, a guest order) are also checked in a real browser by `e2e/smoke.e2e.ts`, which runs in CI. See [testing](testing.md).

## Sign-in

`web/src/pages/SignIn.tsx`, `src/ops/owner-auth.ts`.

Every owner screen sits behind one passcode. I set it in `MISE_OWNER_PASSCODE` (at least 8 characters) before starting the server. If it isn't set, or is too short, sign-in answers 503 with a message saying so. A correct passcode sets a cookie that lasts 30 days, until the server restarts. Too many wrong passcodes from one address locks that address out for a while. Tested by `test/owner-auth.test.ts` and `test/request-guards.test.ts`. Why it works this way: [decision 11](decisions/0011-owner-sign-in.md).

## Today

`web/src/pages/Today.tsx`, `GET /api/kitchen/today`.

This is the screen I open first. It shows the next production date, from the first plan on or after today, with:

- The prep list: what to make, in batches, after using what's on hand. I can tick tasks off. Ticks are kept in the browser for that plan.
- Short: what to buy, with how much I have and need, and the case count rounded up when the item has a case size.
- Preorders for that date, grouped by pickup time, with first name and items only. No phone, no notes, no last name.

If there's no stored plan but guests have ordered for a date, Today still shows what those preorders need.

## Count

`web/src/pages/Count.tsx`, `POST /api/kitchen/counts`.

I pick a location (walk-in, dry storage) and walk the shelves in that location's shelf order. Each row starts at the last count. I change only what's different, or tap "Count as …" under a row to say it's counted and unchanged. Save writes one count event per changed row. A count sets the amount outright. Saving twice with the same `clientId` writes once, so a double tap or a retry on bad wifi is safe. A row the server rejects, such as a unit that doesn't convert, shows its own message.

## Stock

`web/src/pages/Stock.tsx`, `GET /api/kitchen/stock`.

On hand by location, computed from the event log. Each row shows when it was last received and can carry flags: negative, expired or near expiry (from the item's shelf life), and below par (from the item's par, summed over locations). Tapping a row shows its last events, newest first. I can't edit or delete an event: a mistake is fixed by a new event, usually a count. See [decision 3](decisions/0003-stock-is-an-event-log.md).

## Recipes

`web/src/pages/Recipes.tsx`, `POST /api/kitchen/catalog/recipes`.

The list of recipes. Opening one shows its name, its yield (what one batch makes), its components and its cost. I can change the name, the yield and each component's amount, then save. The server validates the whole catalog on save and sends back every problem it finds (a unit that doesn't convert, a recipe cycle), and the screen shows them.

Cost is per batch and per kg, litre or plate. It uses the latest price logged with a delivery for each ingredient. An ingredient that has never had a price is named and left out, so the number is a floor. Sub-recipes, like a dough used in two dishes, cost out through their own ingredients.

## Plan

`web/src/pages/Plan.tsx`, `GET /api/kitchen/plans`, `POST /api/kitchen/catalog/plans`.

Pick a production date and see "to make" per item, then the prep and shopping that follow from it. Each line says where it came from. A manual line I can change and save. A preorder line is rolled in from guest orders and I can't edit it: it changes when guests order. Preorder lines are never stored in the plan, and saving a plan drops them. A date with preorders but no stored plan shows a plan made on the fly. See [decision 12](decisions/0012-preorders-and-stock.md).

## Assistant

`web/src/pages/Assistant.tsx`, `src/kitchen/assistant/`.

A chat where I type what happened: "2 cases eggs in the walk-in", "used 3 kg flour". The assistant looks things up (on hand, shopping list, prep list, max batch, cost) and answers. When I describe a stock change, it puts a proposal card in the reply.

The card lists the lines it understood, in my units. I can edit the lines before I confirm:

- Confirm books the lines as stock events.
- Discard throws it away.
- If stock changed for one of those items after the card was made, the card shows Stale and Confirm is off until I tap Refresh. Then I check it again and confirm.

If the card has a problem (an unknown location, a unit that doesn't convert), the line says so and Confirm stays off.

If a name isn't in the catalog, the assistant offers to add it, as a button with the base unit. The server makes the id, not the screen, and Russian names are transliterated: "Сумах" is saved as `sumakh`. Add only creates. If the name is already an item or an alias, or its id is taken, nothing is replaced and the card says it's already in the catalog as that item. The assistant doesn't make the offer for a name like that in the first place. Adding doesn't book anything. I repeat the change afterwards so it lands on a card. This is how I add items from the screens today. See [decision 14](decisions/0014-the-server-makes-item-ids.md).

The assistant proposes stock changes only. It doesn't change plans, recipes or the catalog, and it never books anything itself. See [decision 4](decisions/0004-model-output-is-a-proposal.md). Its messages cost money like guest chat does, so they count against the same daily budget. The conversation is kept in the browser tab until I close it. If the model can't be reached, it says so and the Count screen still works.

## /order

`web/src/pages/Order.tsx`, `src/agent/`, `src/domain/restaurant.ts`.

The guest page. A guest chats in English or Russian to find out what's on the menu, pick a pickup window and place an order with a name and a phone number. The agent can answer menu questions, check allergens and dietary needs, list pickup windows and hand off to me when it can't help. The rules are code, not prompt: pickup windows have a cap, orders close at the cutoff, one phone number can place only so many, one order has a maximum per item, and a limited batch (40 syrniki) sells out. The same order sent twice is placed once. Quantities are orders, not pieces: "2 syrniki" means two orders of three.

Placed orders appear on Today and feed the Plan screen. The guest chat has a turn limit per conversation, a rate limit per IP and a daily spend cap, and past them it points the guest to Instagram or the phone. Tested by `test/popup.test.ts`, `test/core.test.ts` and the scenarios in `evals/scenarios/`.

### Selling from stock

Off by default. With `popup.sellFromStock` false in `data/restaurants/ruki.json`, a guest can order up to the menu item's `quantity`, even before this week's delivery is logged. If I turn it on, a menu item with `makes` is also limited by what the kitchen can make from stock, after setting aside what the day's plan already needs. If the kitchen item behind a menu item is removed, the server falls back to the menu quantity and logs it. See [decision 12](decisions/0012-preorders-and-stock.md).

## Not there yet

- Adding or editing items and locations from a screen. Items only come in through the assistant's offer, and locations and shelf order are edited in the catalog file.
- Creating a recipe from a screen. The New recipe and Add component buttons on Recipes don't do anything yet, and neither does Add a line on Plan.
- Deleting a recipe or a plan from a screen. The API can do it (`DELETE /api/kitchen/catalog/:kind/:id`).
- Changing the plan from the assistant. It proposes stock changes only.
- Moves between locations from a screen. A move can come through a proposal, but the Count screen only sets counts.
- Receipt photos. Receipts and invoices would become proposals the same way, but there's no code for them.
- More than one owner or more than one kitchen. There's one passcode, and one restaurant per server.
