import {
  collect,
  type ChatChunk,
  type ChatRequest,
  type LLMProvider,
} from "../types";

/**
 * Deterministic provider for tests and offline demos (LLM_PROVIDER=mock).
 * `respond` receives the request and returns the full text, which is streamed in small chunks.
 */
export class MockProvider implements LLMProvider {
  readonly id = "mock";
  readonly label = "Mock";
  readonly capabilities = { json: true, streaming: true, thinking: false };
  readonly requests: ChatRequest[] = [];
  constructor(
    private readonly respond: (request: ChatRequest, call: number) => string,
    readonly model = "mock-1",
  ) {}

  async *stream(request: ChatRequest): AsyncIterable<ChatChunk> {
    this.requests.push(request);
    const text = this.respond(request, this.requests.length);
    for (let i = 0; i < text.length; i += 64) {
      if (request.signal?.aborted) throw new Error("请求已取消");
      yield { type: "text", text: text.slice(i, i + 64) };
    }
    yield {
      type: "done",
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: text.length },
    };
  }

  chat(request: ChatRequest) {
    return collect(this, request);
  }
}
