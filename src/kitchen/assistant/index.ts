import type { LLM } from "../../llm/types.js";
import { today } from "../../agent/agent.js";
import type { ProposalBook } from "../proposals.js";
import type { KitchenAssistant, KitchenStore } from "../types.js";
import { runKitchenTurn, type KitchenSession } from "./loop.js";
import { KitchenMockLLM } from "./mock.js";

export interface AssistantDeps {
  store: KitchenStore;
  proposals: ProposalBook;
  llm: LLM;
  now?: () => Date;
}

const MAX_SESSIONS = 50;

export function createKitchenAssistant(deps: AssistantDeps): KitchenAssistant {
  // The guest mock knows the menu, not the kitchen, so a mock run gets the kitchen one.
  const llm = deps.llm.name === "mock" ? new KitchenMockLLM() : deps.llm;
  const sessions = new Map<string, KitchenSession & { lock: Promise<unknown> }>();

  const sessionFor = (id: string) => {
    let s = sessions.get(id);
    if (!s) {
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      s = { id, messages: [], lock: Promise.resolve() };
      sessions.set(id, s);
    }
    return s;
  };

  return {
    turn(sessionId, text) {
      const s = sessionFor(sessionId);
      // One turn at a time per session, so two quick messages can't interleave their history.
      const run = s.lock.then(async () => {
        const ctx = { store: deps.store, proposals: deps.proposals, today: today((deps.now ?? (() => new Date()))()), offers: [], proposed: [] };
        const { toolCalls: _calls, ...reply } = await runKitchenTurn(llm, s, text, ctx);
        return reply;
      });
      s.lock = run.catch(() => undefined);
      return run;
    },
  };
}
