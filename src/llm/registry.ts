import { OpenAICompatibleProvider } from "./openai-compatible";
import {
  DeepSeekProvider,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
} from "./providers/deepseek";
import { MockProvider } from "./providers/mock";
import { LLMError, type LLMProvider } from "./types";

/**
 * Provider registry. To add a vendor: implement LLMProvider (or subclass OpenAICompatibleProvider),
 * add a factory entry below, and select it with LLM_PROVIDER. Callers never import a vendor directly.
 *
 * Environment:
 *   LLM_PROVIDER        deepseek (default) | openai-compatible | mock
 *   DEEPSEEK_API_KEY    required for deepseek
 *   DEEPSEEK_MODEL      default deepseek-flash
 *   DEEPSEEK_BASE_URL   default https://api.deepseek.com
 *   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL   for openai-compatible (OpenAI, Qwen, Moonshot, vLLM, Ollama…)
 *   LLM_THINKING        "true" to enable reasoning mode where supported
 */
type Env = Record<string, string | undefined>;
type Factory = {
  label: string;
  configured: (env: Env) => boolean;
  model: (env: Env) => string;
  create: (env: Env) => LLMProvider;
};

const mockReply = JSON.stringify({
  reply:
    "（Mock 模型）未修改页面。设置 LLM_PROVIDER=deepseek 与 DEEPSEEK_API_KEY 以使用真实模型。",
  mode: "none",
});

export const providerFactories: Record<string, Factory> = {
  deepseek: {
    label: "DeepSeek",
    configured: (env) => !!env.DEEPSEEK_API_KEY,
    model: (env) => env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULT_MODEL,
    create: (env) =>
      new DeepSeekProvider({
        apiKey: env.DEEPSEEK_API_KEY ?? "",
        model: env.DEEPSEEK_MODEL || DEEPSEEK_DEFAULT_MODEL,
        baseUrl: env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL,
      }),
  },
  "openai-compatible": {
    label: "OpenAI 兼容",
    configured: (env) =>
      !!(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL),
    model: (env) => env.LLM_MODEL ?? "",
    create: (env) =>
      new OpenAICompatibleProvider({
        id: "openai-compatible",
        label: env.LLM_LABEL || "OpenAI 兼容",
        baseUrl: env.LLM_BASE_URL ?? "",
        apiKey: env.LLM_API_KEY ?? "",
        model: env.LLM_MODEL ?? "",
        capabilities: { json: env.LLM_JSON_MODE !== "false" },
      }),
  },
  mock: {
    label: "Mock",
    configured: () => true,
    model: () => "mock-1",
    create: () => new MockProvider(() => mockReply),
  },
};

export function activeProviderId(env: Env = process.env): string {
  return env.LLM_PROVIDER || "deepseek";
}

export function getProvider(env: Env = process.env): LLMProvider {
  const id = activeProviderId(env);
  const factory = providerFactories[id];
  if (!factory)
    throw new LLMError(
      `未知 LLM_PROVIDER：${id}（可选 ${Object.keys(providerFactories).join(" / ")}）`,
      id,
    );
  if (!factory.configured(env))
    throw new LLMError(
      `${factory.label} 未配置。请在 .env.local 设置所需的 API Key（见 docs/ai-chat.md）`,
      id,
    );
  return factory.create(env);
}

/** Safe status for the UI: never includes secrets. */
export function providerStatus(env: Env = process.env) {
  const id = activeProviderId(env);
  const factory = providerFactories[id];
  return {
    provider: id,
    label: factory?.label ?? id,
    model: factory?.model(env) ?? "",
    configured: !!factory?.configured(env),
    thinking: env.LLM_THINKING === "true",
    available: Object.entries(providerFactories).map(([key, f]) => ({
      id: key,
      label: f.label,
      configured: f.configured(env),
    })),
  };
}
