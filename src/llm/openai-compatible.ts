import {
  collect,
  LLMError,
  type ChatChunk,
  type ChatRequest,
  type LLMProvider,
  type ProviderCapabilities,
  type Usage,
} from "./types";

/**
 * Base provider for any OpenAI-compatible /chat/completions endpoint (DeepSeek, OpenAI,
 * Qwen/DashScope compatible mode, Moonshot, Zhipu, vLLM, Ollama, ...).
 * Vendors subclass it only to tweak the request body or parse extra delta fields.
 */
export type OpenAICompatibleOptions = {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities?: Partial<ProviderCapabilities>;
  /** Static extra fields merged into every request body. */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Per-attempt timeout until the first byte, ms. */
  timeoutMs?: number;
  /** Retries for 429 / 5xx / network errors before any output was produced. */
  maxRetries?: number;
  fetch?: typeof fetch;
};

type Delta = { content?: string | null; reasoning_content?: string | null };
type StreamEvent = {
  choices?: { delta?: Delta; finish_reason?: string | null }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
  error?: { message?: string };
};

export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly label: string;
  readonly model: string;
  readonly capabilities: ProviderCapabilities;
  protected readonly options: OpenAICompatibleOptions;

  constructor(options: OpenAICompatibleOptions) {
    if (!options.apiKey)
      throw new LLMError(`${options.label} 未配置 API Key`, options.id);
    this.options = options;
    this.id = options.id;
    this.label = options.label;
    this.model = options.model;
    this.capabilities = {
      json: true,
      streaming: true,
      thinking: false,
      ...options.capabilities,
    };
  }

  /** Override to add vendor-specific request fields. */
  protected buildBody(request: ChatRequest): Record<string, unknown> {
    return {
      model: this.model,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.json && this.capabilities.json
        ? { response_format: { type: "json_object" } }
        : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      ...this.options.extraBody,
    };
  }

  /** Override to map vendor-specific delta fields. */
  protected parseDelta(delta: Delta): ChatChunk[] {
    const chunks: ChatChunk[] = [];
    if (delta.reasoning_content)
      chunks.push({ type: "reasoning", text: delta.reasoning_content });
    if (delta.content) chunks.push({ type: "text", text: delta.content });
    return chunks;
  }

  protected parseUsage(usage: StreamEvent["usage"]): Usage | undefined {
    if (!usage) return undefined;
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      cachedInputTokens:
        usage.prompt_cache_hit_tokens ??
        usage.prompt_tokens_details?.cached_tokens,
    };
  }

  private async open(request: ChatRequest): Promise<Response> {
    const fetcher = this.options.fetch ?? fetch;
    const maxRetries = this.options.maxRetries ?? 2;
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`;
    for (let attempt = 0; ; attempt++) {
      const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeout])
        : timeout;
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: `Bearer ${this.options.apiKey}`,
            ...this.options.headers,
          },
          body: JSON.stringify(this.buildBody(request)),
          signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw new LLMError("请求已取消", this.id);
        if (attempt < maxRetries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new LLMError(
          `${this.label} 网络错误：${error instanceof Error ? error.message : String(error)}`,
          this.id,
          undefined,
          true,
        );
      }
      if (response.ok && response.body) return response;
      const retryable = response.status === 429 || response.status >= 500;
      const detail = await response.text().catch(() => "");
      if (retryable && attempt < maxRetries) {
        await sleep(
          Number(response.headers.get("retry-after")) * 1000 ||
            800 * 2 ** attempt,
        );
        continue;
      }
      throw new LLMError(
        `${this.label} 返回 ${response.status}：${errorMessage(detail)}`,
        this.id,
        response.status,
        retryable,
      );
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const response = await this.open(request);
    const reader = response
      .body!.pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = "";
    let finishReason: string | undefined;
    let usage: Usage | undefined;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (!line.startsWith("data:")) continue; // comments / keep-alives
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;
          let event: StreamEvent;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          if (event.error)
            throw new LLMError(
              `${this.label}：${event.error.message ?? "流式响应错误"}`,
              this.id,
            );
          for (const choice of event.choices ?? []) {
            if (choice.delta) yield* this.parseDelta(choice.delta);
            if (choice.finish_reason) finishReason = choice.finish_reason;
          }
          usage = this.parseUsage(event.usage) ?? usage;
        }
      }
    } catch (error) {
      if (request.signal?.aborted) throw new LLMError("请求已取消", this.id);
      throw error instanceof LLMError
        ? error
        : new LLMError(
            `${this.label} 流中断：${error instanceof Error ? error.message : String(error)}`,
            this.id,
            undefined,
            true,
          );
    } finally {
      reader.releaseLock();
    }
    yield { type: "done", finishReason, usage };
  }

  chat(request: ChatRequest) {
    return collect(this, request);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 8000)));
}
function errorMessage(body: string): string {
  try {
    const parsed = JSON.parse(body);
    return parsed?.error?.message ?? parsed?.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300) || "无响应内容";
  }
}
