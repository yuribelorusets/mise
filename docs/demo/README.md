# Demo screenshots

Recorded by `e2e/demo.e2e.ts` against the mock model on seeded data (a 5 December plan of 40 syrniki, counts for the walk-in and dry storage, prices from one delivery each, two guest preorders). Mobile is 390x844, desktop 1280x800, both in the app's dark theme.

To regenerate them: `npm run web:build && npm run demo`. The raw Playwright output goes to `demo/raw/`, which is not committed.

- `01-sign-in-mobile.png`: the sign-in screen with the passcode typed.
- `02-today-mobile.png`: Today with the prep list and the Short table.
- `03-today-preorders-mobile.png`: Today scrolled to the Preorders list.
- `04-count-mobile.png`: the walk-in count with eggs and farmer's cheese changed.
- `05-count-saved-mobile.png`: the same count after Save.
- `06-assistant-card-mobile.png`: "received 2 cases of eggs" as a card waiting to be booked.
- `07-assistant-booked-mobile.png`: the card after Confirm, marked Booked.
- `08-assistant-stale-mobile.png`: a card marked Stale after someone counted the eggs.
- `09-assistant-refreshed-mobile.png`: the same card refreshed and booked.
- `10-assistant-new-item-mobile.png`: the offer to add sumac as a new item.
- `11-assistant-item-added-mobile.png`: sumac added.
- `12-stock-mobile.png`: Stock by location after the changes.
- `13-stock-history-mobile.png`: the eggs history opened.
- `14-recipes-mobile.png`: the recipe list with a cost for each.
- `15-plan-mobile.png`: the plan with the preorder line rolled in.
- `16-order-menu-mobile.png`: the guest page at `/order` with the menu.
- `17-order-privacy-mobile.png`: the same page scrolled to the privacy notice.
- `18-order-placed-mobile.png`: a guest order placed in chat, with its confirmation.
- `19-today-new-preorder-mobile.png`: Today with the new preorder listed.
- `20-today-desktop.png`: Today at desktop width.
- `21-assistant-desktop.png`: a booked card in the assistant at desktop width.
- `22-plan-desktop.png`: Plan at desktop width.
- `23-order-desktop.png`: `/order` at desktop width after a guest order.
