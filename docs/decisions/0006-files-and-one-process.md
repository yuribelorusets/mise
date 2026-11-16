# 6. JSON files behind a storage interface, and one process

November 2026 · Accepted

## Context

v1 has one kitchen and one user. A database server would be the most complicated part of the deploy.

## Decision

The catalog is a JSON file, written to a temporary file and renamed so a crash can't leave half a file. Stock events and preorders are append-only JSONL files, replayed on startup. Both sit behind a small storage interface. Sessions, the per-conversation lock and rate limits live in the process's memory.

## Alternatives

- **SQLite now.** Real transactions, but a native dependency and a schema to migrate while the model is still changing.
- **Postgres and Redis.** The right answer for many kitchens, wrong for one.

## Consequences

A second instance would break things: two processes would each hold their own locks, sessions and view of stock, and the ledger compaction assumes it's the only writer. That's acceptable for one kitchen, and it's written down rather than discovered. The path to more is Postgres with row locks (or conditional updates) for stock, and Redis or advisory locks for sessions, rate limits and the per-conversation lock, swapped in behind the same interfaces.
