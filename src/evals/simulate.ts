import type { LLM, MessageParam } from "../llm/types.js";

/**
 * A simulated guest, tau-bench style: a second model plays a customer with a
 * persona and a goal, and talks to the agent until the goal is done or hopeless.
 * Scripted turns test what you thought of; simulated guests find what you didn't.
 */
export interface Simulation { persona: string; goal: string; max_turns?: number }

const DONE = "[DONE]";

export function simulatedGuest(llm: LLM, sim: Simulation) {
  const system = `You are role-playing a customer texting a small food business's chat assistant. Stay in character.
Persona: ${sim.persona}
Your goal: ${sim.goal}
Rules:
- Write ONLY the customer's next message: 1-2 short sentences, the way a real person texts. No narration, no quotes.
- Don't volunteer every detail at once. Answer what you're asked; real people forget things.
- Never invent menu items the assistant hasn't mentioned unless your persona would plausibly ask for them.
- When your goal is complete, or the assistant has clearly said it can't be done, reply with exactly ${DONE}.`;
  const history: MessageParam[] = [];

  return {
    maxTurns: sim.max_turns ?? 8,
    /** The guest's next message, or null when they're done. `agentReply` is the agent's last message (undefined at the start). */
    async next(agentReply?: string): Promise<string | null> {
      history.push({ role: "user", content: agentReply ?? "(The chat window just opened. Send your first message.)" });
      const res = await llm.complete({ system, messages: history, tools: [] });
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      history.push({ role: "assistant", content: [{ type: "text", text: text || DONE }] });
      return !text || text.includes(DONE) ? null : text;
    },
  };
}
