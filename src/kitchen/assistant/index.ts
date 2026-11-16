import type { LLM } from "../../llm/types.js";
import type { ProposalBook } from "../proposals.js";
import type { KitchenAssistant, KitchenStore } from "../types.js";

export interface AssistantDeps {
  store: KitchenStore;
  proposals: ProposalBook;
  llm: LLM;
  now?: () => Date;
}

export function createKitchenAssistant(deps: AssistantDeps): KitchenAssistant {
  return {
    async turn() {
      return { reply: "The kitchen assistant isn't built yet.", proposals: [], offers: [], model: deps.llm.name, usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
}
