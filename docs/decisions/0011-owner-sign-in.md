# 11. Owner sign-in: a passcode, a session cookie, and JSON-only writes

November 2026 · Accepted

## Context

The owner screens change stock and plans, so they need sign-in. There's one owner. The old dashboard used a shared token in the URL, which ends up in browser history and logs.

## Decision

- A passcode from `MISE_OWNER_PASSCODE` (at least 8 characters), hashed at startup with scrypt and compared in constant time.
- A random session token in an `HttpOnly; SameSite=Strict` cookie, `Secure` in production. The server keeps only a hash of it. Sessions last 30 days and end when the server restarts.
- Failed sign-ins are rate limited per IP and overall, checked before the passcode is hashed.
- Writes under `/api` must be JSON, and cross-site requests are refused, so another site can't submit a form on my behalf.

## Alternatives

- **Accounts with email or OAuth.** Needed once other chefs use it, and not before.
- **Keep the URL token.** Leaks too easily.

## Consequences

A restart signs me out, which is fine for one owner. Multi-user accounts are the same future work as [6](0006-files-and-one-process.md): a database and real user records. The full design is task D2 in [the wave 2 plan](../plans/wave-2.md).
