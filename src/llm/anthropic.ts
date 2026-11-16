import Anthropic from "@anthropic-ai/sdk";
import type { LLM, LLMRequest, LLMResponse, ContentBlock } from "./types.js";

/** Claude via the Anthropic Messages API, with tool use. */
export class AnthropicLLM implements LLM {
  private client: Anthropic;
  readonly name: string;

  constructor(private model = process.env.MISE_MODEL || "claude-sonnet-5-5", apiKey = process.env.ANTHROPIC_API_KEY) {
    // The SDK's default timeout is 10 minutes. A guest won't wait that long.
    this.client = new Anthropic({ apiKey, timeout: Number(process.env.MISE_LLM_TIMEOUT_MS ?? 30_000), maxRetries: 2 });
    this.name = `anthropic:${model}`;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: req.system,
      ...(req.tools.length ? { tools: req.tools as never } : {}),
      messages: req.messages as never,
    });
    const content: ContentBlock[] = [];
    for (const block of res.content) {
      if (block.type === "text") content.push({ type: "text", text: block.text });
      else if (block.type === "tool_use")
        content.push({ type: "tool_use", id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    return {
      content,
      stop_reason: res.stop_reason ?? "end_turn",
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    };
  }
}
