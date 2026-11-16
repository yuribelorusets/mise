import type { LLM, MessageParam, ToolResultBlock, ToolUseBlock } from "../llm/types.js";
import { toolSpecs, runTool, type ToolContext } from "./tools.js";
import { systemPrompt } from "./prompt.js";
import type { Order } from "../domain/restaurant.js";

export interface ToolCallTrace {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  isError: boolean;
  ms: number;
}

export interface TurnResult {
  reply: string;
  toolCalls: ToolCallTrace[];
  handoff: boolean;
  llmCalls: number;
  usage: { input_tokens: number; output_tokens: number };
  /** The model failed or misbehaved and the reply was written by code instead. */
  degraded?: boolean;
  /** Output checks that fired, e.g. "unverified_code". */
  flags?: string[];
}

export interface Session {
  id: string;
  messages: MessageParam[];
}

/** The restaurant's calendar date. UTC would flip to "tomorrow" at 4pm in California, right before dinner. */
export const today = (now: Date, timeZone = "America/Los_Angeles") =>
  process.env.MISE_TODAY || new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

const MAX_HISTORY = 40; // messages kept per conversation; older turns are dropped whole
const CODE = /\b[A-Z]{2,3}-[A-Z0-9]{6}\b/g;
const HANDOFF_REPLY = "Sorry, I'm having trouble with that. Let me get a team member to help.";

/** Confirmed side effects from this turn, for writing a reply in code when the model can't. */
function confirmations(calls: ToolCallTrace[]) {
  return calls
    .filter((c) => !c.isError && (c.name === "place_order"))
    .map((c) => c.output as Partial<Order> & { location?: string; payment?: string });
}

function confirmationReply(calls: ToolCallTrace[]): string | null {
  const done = confirmations(calls);
  if (!done.length) return null;
  return done
    .map((o) => `Your order ${o.id} is confirmed: pickup ${o.pickupDate ? `${o.pickupDate} ` : ""}at ${o.pickupTime}${o.location ? `, ${o.location}` : ""}. Total $${o.total}.${o.payment ? ` ${o.payment}` : ""}`)
    .join(" ");
}

/** Drop the oldest whole turns (each starts with a guest message) so cost per turn stays flat. */
function trim(messages: MessageParam[]) {
  if (messages.length <= MAX_HISTORY) return messages;
  let start = messages.length - MAX_HISTORY;
  while (start < messages.length && !(messages[start].role === "user" && typeof messages[start].content === "string")) start++;
  return messages.slice(start);
}

/**
 * One guest turn: call the model, run any tools it asks for, feed results back,
 * and repeat until it answers in text. Bounded, and transactional: the session's
 * history only changes when the turn finishes, so a failure mid-turn can't leave
 * a tool call without its result (which the API would reject on every later turn).
 */
export async function runTurn(
  llm: LLM,
  session: Session,
  userText: string,
  ctx: Omit<ToolContext, "sessionId">,
  maxSteps = 6,
): Promise<TurnResult> {
  const config = ctx.store.config;
  const base = trim(session.messages);
  const draft: MessageParam[] = [...base, { role: "user", content: userText }];
  const system = systemPrompt(config, today(ctx.now, config.timezone), ctx.channel);
  const tools = toolSpecs(config);
  const toolCalls: ToolCallTrace[] = [];
  const usage = { input_tokens: 0, output_tokens: 0 };
  let handoff = false;

  /** Commit the turn. A clean turn keeps the model's full exchange; otherwise keep only what the guest saw. */
  const finish = (reply: string, extra: Partial<TurnResult> = {}, step = 0): TurnResult => {
    const clean = !extra.degraded && !extra.flags?.length;
    session.messages = clean
      ? draft
      : [...base, { role: "user", content: userText }, { role: "assistant", content: [{ type: "text", text: reply }] }];
    return { reply, toolCalls, handoff, llmCalls: step, usage, ...extra };
  };

  for (let step = 1; step <= maxSteps; step++) {
    let res;
    try {
      res = await llm.complete({ system, messages: draft, tools });
    } catch (err) {
      console.error(`[mise] model call failed (session ${session.id}, step ${step}):`, (err as Error).message);
      const confirmed = confirmationReply(toolCalls);
      return finish(confirmed ?? HANDOFF_REPLY, { degraded: true, handoff: handoff || !confirmed }, step);
    }
    usage.input_tokens += res.usage?.input_tokens ?? 0;
    usage.output_tokens += res.usage?.output_tokens ?? 0;
    draft.push({ role: "assistant", content: res.content });

    const uses = res.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || uses.length === 0) {
      let reply = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      const flags: string[] = [];
      // Output check: any order code the model mentions must be one the system issued.
      const issued = new Set(ctx.store.orders.map((o) => o.id));
      if ((reply.match(CODE) ?? []).some((c) => !issued.has(c))) {
        flags.push("unverified_code");
        console.warn(`[mise] blocked a reply with an order code the system didn't issue (session ${session.id})`);
        reply = confirmationReply(toolCalls) ?? "I haven't been able to confirm that order yet. Could you tell me again what you'd like, your pickup time, and your name and phone number?";
      }
      if (!reply) return finish(confirmationReply(toolCalls) ?? HANDOFF_REPLY, { degraded: true, handoff: true }, step);
      return finish(reply, flags.length ? { flags, degraded: true } : {}, step);
    }

    const results: ToolResultBlock[] = [];
    for (const use of uses) {
      const t0 = Date.now();
      const out = await runTool(use.name, use.input, { ...ctx, sessionId: session.id });
      if (out.handoff) handoff = true;
      toolCalls.push({ name: use.name, input: use.input, output: out.content, isError: out.isError, ms: Date.now() - t0 });
      results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out.content), is_error: out.isError || undefined });
    }
    draft.push({ role: "user", content: results });
  }
  return finish(confirmationReply(toolCalls) ?? HANDOFF_REPLY, { handoff: true, degraded: true }, maxSteps);
}
