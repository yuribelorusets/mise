import type { LLM, LLMRequest, LLMResponse, MessageParam, ToolUseBlock } from "../../llm/types.js";

/**
 * A small rule-based stand-in for Claude, for the kitchen. It covers the mock-runnable
 * scenarios and the server tests, in English and Russian. It is not the product.
 */
export class KitchenMockLLM implements LLM {
  readonly name = "mock";
  private n = 0;

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const latest = [...req.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string")?.content as string | undefined ?? "";
    const last = req.messages.at(-1);
    if (last?.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result") return this.afterTool(req.messages);
    return this.firstStep(req, latest);
  }

  // ---------- after a tool result ----------
  private afterTool(messages: MessageParam[]): LLMResponse {
    const call = [...messages].reverse().flatMap((m) => (m.role === "assistant" ? m.content.filter((b): b is ToolUseBlock => b.type === "tool_use") : [])).at(0);
    const result = messages.at(-1)!.content as { content: string; is_error?: boolean }[];
    let out: Record<string, unknown> = {};
    try { out = JSON.parse(result[0].content); } catch { /* keep empty */ }
    const failed = result[0].is_error === true;

    if (call?.name === "propose_stock_changes" && failed && Array.isArray(out.unknown) && out.unknown.length) {
      const name = String(out.unknown[0]);
      const lines = (call.input.lines as { item?: unknown; unit?: unknown }[]) ?? [];
      const unit = String(lines.find((l) => String(l.item) === name)?.unit ?? "").toLowerCase();
      return this.tool("offer_new_item", { name, baseUnit: guessBase(unit), raw: name });
    }
    if (failed) return this.text(String(out.error ?? "That didn't work."));
    switch (call?.name) {
      case "offer_new_item": return this.text(`I don't know ${String(call.input.name)} yet. Add it as a new item?`);
      case "propose_stock_changes": {
        const lines = (out.lines as { qty: number; unit: string; name: string; base: number; baseUnit: string }[]) ?? [];
        return this.text(`${lines.map((l) => `${l.qty} ${l.unit} ${l.name} (${l.base} ${l.baseUnit})`).join(", ")}. Confirm the card to book it.`);
      }
      case "on_hand": {
        if (Array.isArray(out.items)) return this.text((out.items as { name: string; total: number; baseUnit: string }[]).map((i) => `${i.name}: ${i.total} ${i.baseUnit}`).join("; ") || "Nothing in stock.");
        return this.text(`${String(out.name)}: ${String(out.total)} ${String(out.baseUnit)}.`);
      }
      case "max_batch": return this.text(out.max === null ? `Stock doesn't limit ${String(out.name)}.` : `You can make ${String(out.max)} ${String(out.unit)} of ${String(out.name)}.`);
      case "shopping_list": {
        const lines = (out.lines as { name: string; buy: number; baseUnit: string }[]) ?? [];
        return this.text(lines.length ? lines.map((l) => `${l.name}: ${l.buy} ${l.baseUnit}`).join("; ") : "Nothing to buy.");
      }
      case "prep_list": {
        const tasks = (out.tasks as { name: string; qty: number }[]) ?? [];
        return this.text(tasks.length ? tasks.map((t) => `${t.name}: ${t.qty}`).join("; ") : "Nothing to prep.");
      }
      case "cost": return this.text(`${String(out.name)}: ${String(out.cost)} total, ${String(out.perUnit)} each.`);
      default: return this.text(HELP);
    }
  }

  // ---------- the owner's message ----------
  private firstStep(req: LLMRequest, text: string): LLMResponse {
    const t = text.toLowerCase();
    const vocab = vocabulary(req.system);
    const named = () => {
      const hit = [...vocab].sort((a, b) => b[0].length - a[0].length).find(([term]) => t.includes(term));
      return hit?.[1];
    };

    if (/how many .* can i make|сколько .* можно сделать/.test(t)) return this.tool("max_batch", { item: named() ?? "unknown" });
    const asked = t.match(/(?:how many|how much|сколько)\s+(.*)/);
    if (asked) {
      const item = named() ?? asked[1].replace(/\b(do|does|did|are|is|have|has|i|we|you|left|in stock)\b.*$/, "").replace(/[?.!]/g, "").trim();
      if (item) return this.tool("on_hand", { item });
    }
    if (/short|shopping|need to buy|купить|не хватает|докупить/.test(t)) return this.tool("shopping_list", {});

    const kind = /count|посчитал|пересчит/.test(t) ? "count" : "receive";
    const lines = parseLines(text).map((l) => ({ kind, ...l }));
    if (lines.length) return this.tool("propose_stock_changes", { lines });
    return this.text(HELP);
  }

  private text(text: string): LLMResponse {
    return { content: [{ type: "text", text }], stop_reason: "end_turn" };
  }
  private tool(name: string, input: Record<string, unknown>): LLMResponse {
    return { content: [{ type: "tool_use", id: `toolu_kmock_${++this.n}`, name, input }], stop_reason: "tool_use" };
  }
}

const HELP = "I can check stock, the shopping list, prep, costs and batch sizes, or put stock changes on a card for you.";

const guessBase = (unit: string) => (["kg", "g", "lb", "lbs", "oz"].includes(unit) ? "g" : ["l", "ml", "qt", "cup", "cups"].includes(unit) ? "ml" : "each");

/** term (id, name or alias, lowercased) -> item id, read from the catalog lines in the prompt. */
function vocabulary(system: string): Map<string, string> {
  const terms = new Map<string, string>();
  for (const line of system.split("\n")) {
    const m = line.match(/^([a-z0-9-]+): (.+?)(?: \((.+?)\))? \[[^\]]*\]$/);
    if (!m) continue;
    for (const term of [m[1], m[2], ...(m[3]?.split(", ") ?? [])]) terms.set(term.toLowerCase(), m[1]);
  }
  return terms;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  один: 1, одна: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
};

const UNITS: Record<string, string> = {
  kg: "kg", кг: "kg", кило: "kg", килограмм: "kg", g: "g", г: "g", гр: "g", грамм: "g", lb: "lb", lbs: "lb", oz: "oz",
  l: "l", л: "l", литр: "l", ml: "ml", мл: "ml", qt: "qt", cup: "cup", cups: "cup",
  case: "case", cases: "case", коробка: "case", коробки: "case", коробку: "case", коробок: "case", ящик: "case", ящика: "case",
  dozen: "dozen", дюжина: "dozen", дюжины: "dozen", each: "each", pc: "each", pcs: "each", шт: "each",
};

const LEAD = /^(?:и\s+)?(?:(?:got|received|counted|count|recount|пришло|пришли|посчитал|посчитала|посчитали|there are|we have|i have)(?![\p{L}])[:,]?\s*)+/iu;
const TAIL = /\s+(?:came in|arrived|today|please|in the \S+|today|сегодня)\s*$/i;

/** `<number> <unit>? <name>` pairs, split on commas and "and". */
function parseLines(text: string) {
  const out: { item: string; qty: number; unit: string; raw: string }[] = [];
  for (const part of text.split(/,|;|(?<![\p{L}])(?:and|и)(?![\p{L}])/iu)) {
    const seg = part.trim().replace(LEAD, "").replace(/[.!?]+$/, "").replace(TAIL, "").trim();
    const m = seg.match(/^(\d+(?:[.,]\d+)?|\p{L}+)\s+(.+)$/u);
    if (!m) continue;
    const qty = /^\d/.test(m[1]) ? Number(m[1].replace(",", ".")) : NUMBER_WORDS[m[1].toLowerCase()];
    if (qty === undefined || !Number.isFinite(qty)) continue;
    const words = m[2].split(/\s+/);
    const unit = UNITS[words[0].toLowerCase()];
    const rest = (unit ? words.slice(1) : words).filter((w, i) => !(i === 0 && /^(of|из)$/i.test(w)));
    const name = rest.join(" ").replace(/[.:]+$/, "").trim();
    if (!name) continue;
    out.push({ item: name, qty, unit: unit ?? "each", raw: seg });
  }
  return out;
}
