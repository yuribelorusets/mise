// Minimal, provider-neutral shapes that mirror the Anthropic Messages API,
// so the agent loop and evals can run against Claude or the offline mock.

export interface TextBlock { type: "text"; text: string }
export interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }

export type ContentBlock = TextBlock | ToolUseBlock;
export type MessageParam =
  | { role: "user"; content: string | (TextBlock | ToolResultBlock)[] }
  | { role: "assistant"; content: ContentBlock[] };

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface LLMRequest { system: string; messages: MessageParam[]; tools: ToolSpec[] }
export interface LLMResponse {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LLM {
  readonly name: string;
  complete(req: LLMRequest): Promise<LLMResponse>;
}
