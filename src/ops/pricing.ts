/** USD per million tokens. Update when prices change; unknown models are costed as Sonnet to stay conservative. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  mock: { input: 0, output: 0 },
};

export function costUsd(model: string, usage: { input_tokens: number; output_tokens: number }) {
  const key = model.replace(/^anthropic:/, "");
  const p = PRICES[key] ?? PRICES["claude-sonnet-5-5"];
  return (usage.input_tokens * p.input + usage.output_tokens * p.output) / 1e6;
}
