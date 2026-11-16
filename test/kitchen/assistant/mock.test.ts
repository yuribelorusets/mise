import { describe, it, expect } from "vitest";
import { createKitchenAssistant } from "../../../src/kitchen/assistant/index.js";
import { runKitchenTurn } from "../../../src/kitchen/assistant/loop.js";
import { KitchenMockLLM } from "../../../src/kitchen/assistant/mock.js";
import { ctx, ev } from "./fixtures.js";

const run = (text: string, events = [ev("eggs", 120)]) => {
  const c = ctx(events);
  return runKitchenTurn(new KitchenMockLLM(), { id: "t", messages: [] }, text, c).then((r) => ({ r, c }));
};

describe("kitchen mock", () => {
  it("puts two received items on one card", async () => {
    const { r, c } = await run("two cases eggs and 5 kg flour came in");
    expect(r.toolCalls.map((t) => t.name)).toEqual(["propose_stock_changes"]);
    const lines = (r.toolCalls[0].input as { lines: { kind: string; item: string }[] }).lines;
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.kind === "receive")).toBe(true);
    expect(r.proposals[0].lines.map((l) => l.item)).toEqual(["eggs", "flour"]);
    expect(r.reply).toMatch(/Confirm the card to book it/);
    expect(c.store.events()).toHaveLength(1);
  });

  it("makes them count lines when the owner counted", async () => {
    const { r } = await run("Counted 3 kg flour");
    expect(r.proposals[0].lines[0].kind).toBe("count");
  });

  it("offers an item it doesn't know, guessing grams from kg", async () => {
    const { r } = await run("пришло 3 кг сумаха");
    expect(r.toolCalls.map((t) => t.name)).toEqual(["propose_stock_changes", "offer_new_item"]);
    expect(r.toolCalls[1].input).toMatchObject({ baseUnit: "g" });
    expect(r.offers).toHaveLength(1);
    expect(r.reply).toMatch(/Add it as a new item\?/);
    expect(r.proposals).toEqual([]);
  });

  it("asks on hand for the named item", async () => {
    const { r } = await run("how many eggs do I have");
    expect(r.toolCalls[0]).toMatchObject({ name: "on_hand", input: { item: "eggs" } });
    expect(r.reply).toMatch(/120/);
  });

  it("answers a shortfall with the numbers the tool gave", async () => {
    const { r } = await run("what am I short for Saturday?");
    expect(r.toolCalls[0].name).toBe("shopping_list");
    expect(r.reply).toMatch(/\d/);
  });

  it("asks for max batch before it asks on hand", async () => {
    const { r } = await run("how many orders of syrniki can I make?");
    expect(r.toolCalls[0]).toMatchObject({ name: "max_batch", input: { item: "syrniki" } });
  });

  it("says what it can do when it has no idea", async () => {
    const { r } = await run("tell me a joke");
    expect(r.toolCalls).toEqual([]);
    expect(r.reply).toMatch(/I can check stock/);
  });

  it("is picked by the assistant when the model is named mock", async () => {
    const c = ctx();
    const a = createKitchenAssistant({ store: c.store, proposals: c.proposals, llm: { name: "mock", complete: async () => { throw new Error("guest mock was used"); } } });
    const r = await a.turn("owner", "two cases eggs came in");
    expect(r.proposals).toHaveLength(1);
  });
});
