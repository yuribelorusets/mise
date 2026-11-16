import type { LLM, MessageParam, ToolResultBlock, ToolUseBlock } from "../../llm/types.js";
import type { ToolCallTrace } from "../../agent/agent.js";
import type { AssistantReply } from "../types.js";
import { KITCHEN_TOOLS, runKitchenTool, type KitchenToolContext } from "./tools.js";
import { kitchenPrompt } from "./prompt.js";

export interface KitchenSession { id: string; messages: MessageParam[] }
export type KitchenTurn = AssistantReply & { toolCalls: ToolCallTrace[] };

const MAX_HISTORY = 40;
export const UNREACHABLE = "The assistant can't reach the model right now. The count screen still works.";
const GAVE_UP = "I couldn't finish that. Try asking a smaller question.";

/** Keep the last MAX_HISTORY messages, starting at a user text message so a tool result never loses its call. */
function trim(messages: MessageParam[]) {
  if (messages.length <= MAX_HISTORY) return messages;
  let start = messages.length - MAX_HISTORY;
  while (start < messages.length && !(messages[start].role === "user" && typeof messages[start].content === "string")) start++;
  return messages.slice(start);
}

/**
 * One owner turn: bounded, and transactional like the guest loop. The session's
 * history changes only when the turn finishes, so a failed call leaves it as it was.
 */
export async function runKitchenTurn(llm: LLM, session: KitchenSession, text: string, ctx: KitchenToolContext, maxSteps = 6): Promise<KitchenTurn> {
  const base = trim(session.messages);
  const draft: MessageParam[] = [...base, { role: "user", content: text }];
  const system = kitchenPrompt(ctx.store.catalog(), ctx.today);
  const toolCalls: ToolCallTrace[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };

  const done = (reply: string, keep: MessageParam[]): KitchenTurn => {
    session.messages = keep;
    return { reply, proposals: ctx.proposed, offers: ctx.offers, model: llm.name, usage, toolCalls };
  };
  /** Keep only what the owner saw, when the model's own exchange isn't worth keeping. */
  const brief = (reply: string): MessageParam[] => [...base, { role: "user", content: text }, { role: "assistant", content: [{ type: "text", text: reply }] }];

  for (let step = 1; step <= maxSteps; step++) {
    let res;
    try {
      res = await llm.complete({ system, messages: draft, tools: KITCHEN_TOOLS });
    } catch (err) {
      console.error(`[mise] kitchen model call failed (session ${session.id}, step ${step}):`, (err as Error).message);
      return { reply: UNREACHABLE, proposals: ctx.proposed, offers: ctx.offers, model: llm.name, usage, toolCalls };
    }
    usage.input_tokens += res.usage?.input_tokens ?? 0;
    usage.output_tokens += res.usage?.output_tokens ?? 0;
    draft.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      const reply = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      return reply ? done(reply, draft) : done(GAVE_UP, brief(GAVE_UP));
    }

    const results: ToolResultBlock[] = [];
    for (const use of uses) {
      const t0 = Date.now();
      const out = runKitchenTool(use.name, use.input, ctx);
      toolCalls.push({ name: use.name, input: use.input, output: out.content, isError: out.isError, ms: Date.now() - t0 });
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.content), is_error: out.isError || undefined });
    }
    draft.push({ role: "user", content: results });
  }
  return done(GAVE_UP, brief(GAVE_UP));
}
