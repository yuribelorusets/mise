---
name: add-eval-scenario
description: How to write a Mise eval scenario in evals/scenarios/*.yaml, including end-state checks, tags and the mock CI gate. Use when adding or changing an eval scenario.
---

# Adding an eval scenario

Scenarios live in `evals/scenarios/`:
- `core.yaml` for Fennel & Ash, the demo restaurant
- `ruki.yaml` for the pop-up
- `redteam.yaml` for attacks and simulated guests

The format is defined by `Scenario` in `src/evals/run.ts` and `Expectation` in `src/evals/graders.ts`. Read those if anything here looks out of date.

## The frozen clock

"Today" is Friday 2026-12-04. "Tomorrow" is 2026-12-05.
- Fennel & Ash is closed Mondays, and tonight at 19:00 is fully booked.
- Ruki's preorders close the evening before the Saturday 2026-12-05 pop-up.

Write dates in expectations as `YYYY-MM-DD` and times as `HH:MM`, 24-hour.

## Shape

```yaml
- id: ruki-preorder-ru            # kebab-case, prefixed with the business or area
  restaurant: ruki                # omit for fennel-ash
  tags: [popup, orders]           # reuse existing tags: booking, orders, safety, menu, multilingual,
                                  # multi-turn, escalation, redteam, simulated, popup
  turns:                          # scripted guest messages, in order
    - "Хочу заказать 2 сырники на 11:00"
    - "Аня, 510-555-0201"
  expect:
    end_state: { new_orders: 1, order: { pickupTime: "11:00", items: { syrniki: 2 } } }
    tools_called: [{ name: place_order, input: { pickupTime: "11:00" } }]
    tools_not_called: [create_reservation]
    reply_matches: ["RK-[A-Z0-9]{6}"]       # regex; "(?i)" prefix for case-insensitive
    reply_must_not_include: ["Satay"]
    events: [order.placed]
    language: ru                            # en | es | ru | fr
  notes: Why this scenario exists, in one sentence.
```

To start from a nearly sold-out batch, add `setup.orders`. See the red-team scenarios for examples.

## Which checks to use

1. **Use `end_state` first.** It checks what actually exists after the conversation, so it doesn't care how the model got there. Nearly every scenario that orders or books should have one. Use `new_orders: 0` for "must not order".
2. **Use `tools_called` / `tools_not_called`** when the path itself matters, such as checking allergens before answering, or never booking a full slot.
3. **Keep reply regexes loose.** Match a code, a time or a key word, never a full sentence. Claude words things differently every run.
4. **The always-on check** fails any reply that shows an order code the system didn't issue. You don't need to add it.

Pass a partial `input`: `tools_called` matches when every key you list is present, so list only the arguments that matter.

## The mock gate

`test/evals.test.ts` runs every scripted scenario on the offline mock in CI, and all of them must pass. So:
- Run `npx vitest run test/evals.test.ts -t <id>` after adding a scenario.
- If it passes on Claude but fails on the mock, the mock (`src/llm/mock.ts`) doesn't understand the phrasing. That's a decision for the owner: extend the mock, or change how scenarios are gated. Don't quietly change either.
- Scenarios with `simulate:` instead of `turns:` are skipped on the mock.

## Simulated guests

```yaml
  simulate:
    persona: Who the guest is and how they write.
    goal: What they want, including names and phone numbers to give when asked.
```

Grade these with `end_state` only. Run them with `npm run eval -- --tag simulated --trials 4`, which uses Claude and costs money.
