# 14. The server makes item ids, and adding an item only creates

November 2026 · Accepted

## Context

When the assistant meets a name it doesn't know, it offers to add it, and the card has an Add button. At first the button made the id itself, with a small `slug()` function in the screen, and posted the whole record to the catalog route, which saves a record under its id and replaces any record that already has that id. The wave 2 security pass found two problems with that. "Eggs!" passed the name check, slugged to `eggs`, and Add replaced the real eggs item, with its aliases, units and allergens. And a Russian name like "Сумах" slugged to nothing, so Add never worked for it.

## Decision

- One function, `itemIdFor` in `src/kitchen/catalog.ts`, turns a name into an id. It transliterates Russian with a small fixed table, drops accents, and returns an empty string when nothing usable is left. Only the server calls it.
- The assistant's `offer_new_item` works out the id when it makes the offer, and refuses a name that has no id, an id that's taken, or one already offered in the same turn. The offer carries the id.
- The screen sends only a name and a base unit to a new route, `POST /api/kitchen/items`. The route makes the id itself, takes none from the body, and only creates: it answers 409 for a taken id or for a name that's already an item or an alias, and 422 for an empty id or a bad base unit.
- The replace route, `POST /api/kitchen/catalog/:kind`, stays. The Recipes and Plan screens need it, because saving a recipe or a plan is replacing it.

## Alternatives

- **Fix `slug()` in the screen.** Two copies of the rule (screen and server) would drift, and the screen can't see the whole catalog as it is at the moment of the request.
- **Make the replace route refuse an existing id for items.** It would break editing an item later, and the Recipes and Plan screens already rely on replace for their kinds.
- **A transliteration library.** One more dependency for an alphabet I can write out in a dozen lines.

## Consequences

An item's id never changes after it's made, and nothing the screen sends can overwrite another item. The cost is two routes that write to the catalog, and a rule I have to remember: adding goes through `/items`, editing through `/catalog/items`. The id of a Russian name is only as readable as its transliteration ("Творог 9%" becomes `tvorog-9`). A name that's only symbols can't be added until I name it in letters or digits.
