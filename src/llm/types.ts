/**
 * Provider-agnostic LLM contract. Everything above this layer (page agent, API routes, UI)
 * only depends on these types, so switching vendor = adding a provider + changing LLM_PROVIDER.
 */
export type ChatRole = "system" | "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export type ChatRequest = {
  messages: ChatMessage[];
  /** Ask the provider for a single JSON object (vendor "JSON mode"). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Enable vendor reasoning/"thinking" mode when supported. */
  thinking?: boolean;
  signal?: AbortSignal;
};

export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

export type ChatChunk =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "done"; finishReason?: string; usage?: Usage };

export type ChatResult = {
  text: string;
  reasoning?: string;
  finishReason?: string;
  usage?: Usage;
  model: string;
};

export type ProviderCapabilities = {
  json: boolean;
  streaming: boolean;
  thinking: boolean;
};

export interface LLMProvider {
  /** Stable id used in configuration, e.g. "deepseek". */
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  /** Stream a completion. Implementations must honour request.signal. */
  stream(request: ChatRequest): AsyncIterable<ChatChunk>;
  /** Convenience: collect the stream into one result. */
  chat(request: ChatRequest): Promise<ChatResult>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

/** Shared helper so every provider implements chat() the same way. */
export async function collect(
  provider: LLMProvider,
  request: ChatRequest,
): Promise<ChatResult> {
  let text = "";
  let reasoning = "";
  let finishReason: string | undefined;
  let usage: Usage | undefined;
  for await (const chunk of provider.stream(request)) {
    if (chunk.type === "text") text += chunk.text;
    else if (chunk.type === "reasoning") reasoning += chunk.text;
    else {
      finishReason = chunk.finishReason;
      usage = chunk.usage;
    }
  }
  return {
    text,
    reasoning: reasoning || undefined,
    finishReason,
    usage,
    model: provider.model,
  };
}
