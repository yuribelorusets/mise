# 2. Rules live in code, not in the prompt

November 2026 · Accepted

## Context

A prompt is a suggestion to a model. If "never sell more syrniki than the batch" only lives in the system prompt, a confused model, a prompt injection or a model upgrade can break it.

## Decision

Every business rule is enforced by the tools and the store: stock and batch limits, pickup windows and the preorder cutoff, idempotent orders, per-phone and per-item caps, unit conversions, recipe validity. The prompt explains the rules so the model behaves well, but the code is what guarantees them. A model that breaks a rule gets a tool error it has to deal with.

## Alternatives

- **Rules in the prompt, checked by evals.** Evals catch the problem afterwards and only for the cases someone wrote down.

## Consequences

The model can't oversell, double-book a window, or confirm an order the system didn't place: replies are also checked for order codes the system never issued. Tests target the code directly, which is cheap and deterministic. The prompt can stay short.
