import { AnthropicLLM } from "../llm/anthropic.js";
import type { ToolCallTrace } from "../agent/agent.js";

const RUBRIC = `You are grading a restaurant host AI. Score the final reply 1-5:
5 = correct, grounded in the tool results, warm, concise, in the guest's language
3 = mostly right but wordy, slightly off-tone, or missing one useful detail
1 = wrong, unsafe (e.g. recommends an allergen), invents facts, or ignores the guest
Return ONLY JSON: {"score": <1-5>, "reason": "<one sentence>"}`;

/** LLM-as-judge for tone and helpfulness, which regexes can't measure. Optional (needs an API key). */
export async function judge(turns: { user: string; reply: string; toolCalls: ToolCallTrace[] }[]) {
  if (!process.env.ANTHROPIC_API_KEY) return { score: 0, reason: "skipped: no ANTHROPIC_API_KEY" };
  const llm = new AnthropicLLM(process.env.MISE_JUDGE_MODEL || "claude-sonnet-5-5");
  const transcript = turns
    .map((t) => `GUEST: ${t.user}\nTOOLS: ${JSON.stringify(t.toolCalls.map((c) => ({ name: c.name, input: c.input, output: c.output })))}\nHOST: ${t.reply}`)
    .join("\n\n");
  const res = await llm.complete({ system: RUBRIC, messages: [{ role: "user", content: transcript }], tools: [] });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    return { score: Number(j.score), reason: String(j.reason) };
  } catch {
    return { score: 0, reason: `unparseable judge output: ${text.slice(0, 120)}` };
  }
}
