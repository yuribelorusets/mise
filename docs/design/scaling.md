# Scaling

Mise today is one kitchen, one owner and one process. This note says what changes when that stops being true, what I'd do first, and why none of it is needed yet.

## What's tied to one process

- **The files.** The catalog is rewritten through a `.tmp` file and a rename, and stock events are appended to a JSONL file ([`src/kitchen/file-store.ts`](../../src/kitchen/file-store.ts)). The guest ledger is compacted by rewriting it from memory ([`src/ops/ledger.ts`](../../src/ops/ledger.ts)). Two processes on one data directory would each hold their own copy of the log in memory, and the second one's compaction would drop lines the first had just appended.
- **Locks.** Confirming a proposal works because `ProposalBook.confirm` runs with no `await` in between, so two requests in one process can't both book ([`src/kitchen/proposals.ts`](../../src/kitchen/proposals.ts)). The per-conversation lock for guest chat and the assistant's per-session lock are in-memory too. Across processes none of these hold.
- **Sessions and limits.** Owner sessions, failed sign-in counts, the per-IP chat limit and the daily spend counter all live in memory. A restart signs me out and resets them. Two processes would each give out their own allowance.
- **One kitchen per server.** `MISE_RESTAURANT` picks a single config at startup, and the kitchen id names the data files (`ruki.catalog.json`, `ruki.stock.jsonl`). There's one passcode.

Decisions [6](../decisions/0006-files-and-one-process.md) and [11](../decisions/0011-owner-sign-in.md) chose this on purpose, and both name the way out.

## What I'd do first

A database, and only that. Postgres behind the `KitchenStore` interface (`src/kitchen/types.ts`). It's the smallest change that fixes the part that can lose data. Stock events become rows with a unique event id, so a retried write still counts once. The stale check ("is there an event after `basedOn` for these items") becomes a query. Confirming a proposal becomes one transaction, with a row lock on the proposal, instead of "no `await` in between". The in-memory store and the file store already sit behind that interface and each has its own tests (`test/kitchen/file-store.test.ts`, `test/kitchen/memory-store.test.ts`), so a database store would get the same set.

I'd leave sessions and rate limits in memory until I actually run a second process. Then they move to Redis (or to the same database), and the per-conversation lock becomes an advisory lock.

## Then, in this order

1. **Several processes.** Needed for deploys without downtime, not for load. The measured load test (`npm run loadtest -- 300 50`) passes on one process, and a pop-up has a few hundred guests, not thousands. Sessions, limits, locks and the daily budget go to shared storage. The ledger stops being a file that one process compacts.
2. **Accounts.** A user table, one row per person, and a kitchen they belong to. The passcode and the 30-day cookie become real sessions with a way to end one. Sign-in rate limiting stays per IP.
3. **Several kitchens per server.** Every store call takes a kitchen id from the signed-in user, not from an environment variable. The restaurant config (menu, pickup windows, `sellFromStock`) moves from `data/restaurants/*.json` into the database, one per kitchen. Today it's read once at startup.

## Why it isn't needed yet

Ruki is one pop-up with one owner who counts stock on a phone. A second process would add a failure mode (two writers) to fix a problem I don't have (one process too slow). The files are easy to read, copy and restore by hand, which matters more right now than throughput. The cost is written down in decision 6: don't run two copies against one data directory. If I ever do, the first sign will be stock events that don't match what I counted, which is why the database comes first.
