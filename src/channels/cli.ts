import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadRestaurant, RestaurantStore } from "../domain/restaurant.js";
import { WebhookClient } from "../integrations/webhook.js";
import { runTurn, type Session } from "../agent/agent.js";
import { makeLLM, now } from "../config.js";

const config = loadRestaurant();
const llm = makeLLM(undefined, undefined, config);
const store = new RestaurantStore(config);
const webhook = new WebhookClient();
const session: Session = { id: `cli-${Date.now()}`, messages: [] };
const rl = createInterface({ input: stdin, output: stdout });
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

console.log(`Mise (${llm.name}). Talk to ${config.name} in any language. Ctrl+C to quit.\n`);
for (;;) {
  const text = await rl.question("you  > ");
  if (!text.trim()) continue;
  const turn = await runTurn(llm, session, text, { store, webhook, channel: "chat", now: now() });
  for (const c of turn.toolCalls) console.log(dim(`  ↳ ${c.name}(${JSON.stringify(c.input)}) ${c.isError ? "ERROR" : "ok"} ${c.ms}ms`));
  console.log(`mise > ${turn.reply}\n`);
}
