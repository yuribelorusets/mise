# 13. Built with agents, with every branch reviewed

November 2026 · Accepted

## Context

I build with Claude Code. I wanted the history to read like real work: small steps, every change explainable, and the reviewing done on purpose rather than hoped for.

## Decision

- A main session plans, writes shared interfaces, and merges.
- Builder agents each take one work package on their own branch and worktree, test first, small commits, and touch only the files their package owns.
- A reviewer (correctness and project rules) and a security reviewer (privacy, security, robustness, each finding proved with a failing test) read every branch before it merges. Serious findings are fixed first; the rest go in [the security backlog](../security-backlog.md).
- History stays linear. Claude is credited once in the README, not on every commit.

## Consequences

A round of read-only reviews costs about as much as one builder's first pass, and they've caught real problems: test coverage silently dropped in a cleanup, a spending cap that didn't count part of the spend, and guest details that stayed visible after the retention cleanup. Costs are measured per agent run and written up in `docs/agents.md`.
