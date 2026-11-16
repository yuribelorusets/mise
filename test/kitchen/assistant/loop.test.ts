import { describe, it, expect } from "vitest";
import type { LLM, LLMResponse } from "../../../src/llm/types.js";
import { createKitchenAssistant } from "../../../src/kitchen/assistant/index.js";
import { runKitchenTurn } from "../../../src/kitchen/assistant/loop.js";
import { kitchenPrompt } from "../../../src/kitchen/assistant/prompt.js";
import { ctx, ruki } from "./fixtures.js";

const scripted = (...steps: LLMResponse[]): LLM => {
  let i = 0;
  return { name: "scripted", complete: async () => steps[Math.min(i++, steps.length - 1)] };
};
const tool = (name: string, input: Record<string, unknown>): LLMResponse =>
  ({ content: [{ type: "tool_use", id: `t-${name}`, name, input }], stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 5 } });
const text = (t: string): LLMResponse => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });

describe("kitchen assistant loop", () => {
  it("returns the proposal it made and books nothing", async () => {
    const c = ctx();
    const a = createKitchenAssistant({ store: c.store, proposals: c.proposals, llm: scripted(
      tool("propose_stock_changes", { lines: [{ kind: "receive", item: "eggs", qty: 2, unit: "case", raw: "two cases eggs" }] }),
      text("2 cases of eggs, 360, to the walk-in. Confirm the card to book it."),
    ) });
    const r = await a.turn("owner", "two cases eggs came in");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].status).toBe("open");
    expect(c.store.events()).toHaveLength(0);
    expect(r.usage).toEqual({ input_tokens: 20, output_tokens: 10 });
  });

  it("stops after six model calls", async () => {
    const c = ctx();
    let calls = 0;
    const inner = scripted(tool("on_hand", {}));
    const llm: LLM = { name: "counting", complete: async (req) => (calls++, inner.complete(req)) };
    const a = createKitchenAssistant({ store: c.store, proposals: c.proposals, llm });
    const r = await a.turn("owner", "loop forever");
    expect(r.reply).toMatch(/\S/);
    expect(calls).toBe(6);
  });

  it("keeps the history unchanged when the model fails mid-turn", async () => {
    const c = ctx();
    let calls = 0;
    const seen: number[] = [];
    const llm: LLM = {
      name: "flaky",
      complete: async (req) => {
        seen.push(req.messages.length);
        if (calls++ === 1) throw new Error("529");
        return calls === 1 ? tool("on_hand", {}) : text("ok");
      },
    };
    const a = createKitchenAssistant({ store: c.store, proposals: c.proposals, llm });
    const r = await a.turn("owner", "how many eggs");
    expect(r.reply).toMatch(/count screen/);
    expect(r.proposals).toEqual([]);
    await a.turn("owner", "again");
    expect(seen[2]).toBe(1);
  });

  it("still returns the card when the model fails after proposing", async () => {
    const c = ctx();
    let calls = 0;
    const llm: LLM = { name: "flaky", complete: async () => { if (calls++ === 1) throw new Error("529"); return tool("propose_stock_changes", { lines: [{ kind: "receive", item: "eggs", qty: 1, unit: "case" }] }); } };
    const a = createKitchenAssistant({ store: c.store, proposals: c.proposals, llm });
    const r = await a.turn("owner", "a case of eggs");
    expect(r.reply).toMatch(/count screen/);
    expect(r.proposals).toHaveLength(1);
  });

  it("books one card for the same lines proposed twice in a turn", async () => {
    const c = ctx();
    const lines = [{ kind: "receive", item: "eggs", qty: 1, unit: "case" }];
    const a = createKitchenAssistant({ store: c.store, proposals: c.proposals, llm: scripted(
      { content: [{ type: "tool_use", id: "a", name: "propose_stock_changes", input: { lines } }, { type: "tool_use", id: "b", name: "propose_stock_changes", input: { lines } }], stop_reason: "tool_use" },
      text("On the card."),
    ) });
    const r = await a.turn("owner", "a case of eggs");
    expect(r.proposals).toHaveLength(1);
    expect(c.proposals.list("open")).toHaveLength(1);
  });

  it("caps the tool calls in one turn", async () => {
    const c = ctx();
    const many = { content: Array.from({ length: 8 }, (_, i) => ({ type: "tool_use" as const, id: `t${i}`, name: "on_hand", input: {} })), stop_reason: "tool_use" };
    const r = await runKitchenTurn(scripted(many, many, text("done")), { id: "t", messages: [] }, "go", c);
    expect(r.reply).toBe("done");
    expect(r.toolCalls.filter((t) => !t.isError)).toHaveLength(12);
    expect(r.toolCalls.filter((t) => t.isError)).toHaveLength(4);
  });

  it("puts the catalog and the no-guessing rule in the prompt", () => {
    const p = kitchenPrompt(ruki, "2026-12-04");
    expect(p).toMatch(/farmers-cheese: Farmer's cheese \(tvorog, творог\)/);
    expect(p).toMatch(/offer_new_item/);
    expect(p).toMatch(/Friday 2026-12-04/);
  });
});
