import {
  OpenAICompatibleProvider,
  type OpenAICompatibleOptions,
} from "../openai-compatible";
import type { ChatRequest } from "../types";

/**
 * DeepSeek (https://api-docs.deepseek.com). OpenAI-compatible chat completions with:
 * - JSON output via response_format {type:"json_object"} (prompt must mention "json"),
 * - switchable thinking mode via `thinking: {type: "enabled" | "disabled"}`, streamed as reasoning_content.
 * Models (2026-10): deepseek-flash (default, fast) and deepseek-v4-pro.
 */
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type DeepSeekOptions = Partial<
  Omit<OpenAICompatibleOptions, "id" | "label">
> & { apiKey: string };

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(options: DeepSeekOptions) {
    super({
      id: "deepseek",
      label: "DeepSeek",
      baseUrl: DEEPSEEK_BASE_URL,
      model: DEEPSEEK_DEFAULT_MODEL,
      timeoutMs: 90_000,
      ...options,
      capabilities: {
        json: true,
        streaming: true,
        thinking: true,
        ...options.capabilities,
      },
    });
  }

  protected buildBody(request: ChatRequest): Record<string, unknown> {
    return {
      ...super.buildBody(request),
      thinking: { type: request.thinking ? "enabled" : "disabled" },
    };
  }
}
