import { describe, it, expect } from "vitest";
import { DeepSeekProvider } from "../src/llm/providers/deepseek";
import { MockProvider } from "../src/llm/providers/mock";
import { getProvider, providerStatus } from "../src/llm/registry";
import { LLMError } from "../src/llm/types";
import {
  runPageAgent,
  documentToCommands,
  extractJson,
  buildSystemPrompt,
  AgentError,
} from "../src/ai/page-agent";
import { applyCommands } from "../src/core/agent-ops";
import { createDocument } from "../src/core/document";
import { makeNode } from "../src/core/registry";
import { pageProtocol } from "../src/core/page-protocol";
import { execute } from "../src/core/commands";
import { validateDocument } from "../src/core/validation";

const sse = (events: unknown[]) =>
  new Response(
    events
      .map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`)
      .join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );

describe("DeepSeek provider", () => {
  it("sends an OpenAI-compatible streaming request with JSON mode and thinking switch, and parses reasoning/text/usage", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = new DeepSeekProvider({
      apiKey: "sk-test",
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return sse([
          { choices: [{ delta: { reasoning_content: "想一想" } }] },
          { choices: [{ delta: { content: '{"a":' } }] },
          ": keep-alive",
          { choices: [{ delta: { content: "1}" }, finish_reason: "stop" }] },
          {
            choices: [],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4,
              prompt_cache_hit_tokens: 6,
            },
          },
          "[DONE]",
        ]);
      },
    });
    const result = await provider.chat({
      messages: [{ role: "user", content: "json please" }],
      json: true,
      thinking: true,
      maxTokens: 100,
    });
    expect(result).toEqual({
      text: '{"a":1}',
      reasoning: "想一想",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 4, cachedInputTokens: 6 },
      model: "deepseek-flash",
    });
    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(
      (calls[0].init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer sk-test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      model: "deepseek-flash",
      stream: true,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      max_tokens: 100,
    });
  });

  it("retries 429/5xx and surfaces non-retryable errors with the vendor message", async () => {
    let n = 0;
    const flaky = new DeepSeekProvider({
      apiKey: "k",
      fetch: async () =>
        ++n < 3
          ? new Response("busy", { status: 503 })
          : sse([{ choices: [{ delta: { content: "ok" } }] }]),
    });
    expect(
      (await flaky.chat({ messages: [{ role: "user", content: "x" }] })).text,
    ).toBe("ok");
    expect(n).toBe(3);
    const denied = new DeepSeekProvider({
      apiKey: "k",
      fetch: async () =>
        new Response(
          JSON.stringify({ error: { message: "Authentication Fails" } }),
          { status: 401 },
        ),
    });
    await expect(
      denied.chat({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({
      status: 401,
      message: expect.stringContaining("Authentication Fails"),
    });
  });

  it("is selected from the environment without leaking secrets", () => {
    expect(() => getProvider({ LLM_PROVIDER: "deepseek" })).toThrow(LLMError);
    const provider = getProvider({
      DEEPSEEK_API_KEY: "sk-secret",
      DEEPSEEK_MODEL: "deepseek-v4-pro",
    });
    expect([provider.id, provider.model]).toEqual([
      "deepseek",
      "deepseek-v4-pro",
    ]);
    const status = providerStatus({ DEEPSEEK_API_KEY: "sk-secret" });
    expect(status).toMatchObject({
      provider: "deepseek",
      model: "deepseek-flash",
      configured: true,
    });
    expect(JSON.stringify(status)).not.toContain("sk-secret");
    expect(
      getProvider({
        LLM_PROVIDER: "openai-compatible",
        LLM_BASE_URL: "http://x/v1",
        LLM_API_KEY: "k",
        LLM_MODEL: "qwen",
      }).model,
    ).toBe("qwen");
  });
});

describe("page agent", () => {
  const document = createDocument();
  it("builds a system prompt that lists every component and mentions json", () => {
    const prompt = buildSystemPrompt();
    for (const ref of ["shadcn.tabs", "shadcn.badge", "composite.data-table"])
      expect(prompt).toContain(ref);
    expect(prompt.toLowerCase()).toContain("json");
  });

  it("applies commands, repairing invalid output with validator feedback", async () => {
    const badge = makeNode("shadcn.badge", "new-badge");
    const provider = new MockProvider((_req, call) =>
      call === 1
        ? JSON.stringify({
            reply: "x",
            mode: "commands",
            commands: [
              {
                type: "node.insert",
                node: badge,
                target: { parentId: "context", slot: "children", index: 0 },
              },
            ],
          })
        : "```json\n" +
          JSON.stringify({
            reply: "已添加徽标",
            mode: "commands",
            commands: [
              {
                type: "node.insert",
                node: badge,
                target: { parentId: "workspace", slot: "children", index: 1 },
              },
            ],
          }) +
          "\n```",
    );
    const events: string[] = [];
    const result = await runPageAgent({
      provider,
      messages: [{ role: "user", content: "加一个徽标" }],
      document,
      onEvent: (e) => events.push(e.type),
    });
    expect(result.attempts).toBe(2);
    expect(result.reply).toBe("已添加徽标");
    expect(result.document.root[0].slots.children[1].id).toBe("new-badge");
    expect(events).toContain("issues");
    const feedback = provider.requests[1].messages.at(-1)!.content;
    expect(feedback).toContain("未通过校验");
    expect(provider.requests[0].json).toBe(true);
    // the returned command reproduces the agent's document in the editor engine
    const replay = execute(document, 0, {
      id: "1",
      timestamp: "",
      actor: { type: "agent", id: "t" },
      pageId: document.id,
      baseRevision: 0,
      command: result.command!,
    });
    expect(replay.success && replay.document).toEqual(result.document);
  });

  it("converts a full document answer into one undoable batch, including listDetail", async () => {
    const next = structuredClone(pageProtocol().formTemplate);
    next.name = "记录管理";
    next.root[1].props = { title: "记录详情" };
    const provider = new MockProvider(() =>
      JSON.stringify({ reply: "已生成", mode: "document", document: next }),
    );
    const result = await runPageAgent({
      provider,
      messages: [{ role: "user", content: "做个记录管理页" }],
      document,
    });
    expect(result.mode).toBe("document");
    expect(result.document).toEqual(next);
    const replay = execute(document, 0, {
      id: "1",
      timestamp: "",
      actor: { type: "agent", id: "t" },
      pageId: document.id,
      baseRevision: 0,
      command: result.command!,
    });
    expect(replay.success && replay.document).toEqual(next);
    if (replay.success) {
      const undone = execute(replay.document, 1, {
        id: "2",
        timestamp: "",
        actor: { type: "agent", id: "t" },
        pageId: document.id,
        baseRevision: 1,
        command: replay.inverseCommand,
      });
      expect(undone.success && undone.document).toEqual(document);
    }
  });

  it("returns none without touching the page, and fails cleanly after max attempts", async () => {
    const none = await runPageAgent({
      provider: new MockProvider(() => '{"reply":"做不到","mode":"none"}'),
      messages: [{ role: "user", content: "接入支付" }],
      document,
    });
    expect([none.mode, none.command, none.document]).toEqual([
      "none",
      undefined,
      document,
    ]);
    await expect(
      runPageAgent({
        provider: new MockProvider(() => "not json"),
        messages: [{ role: "user", content: "x" }],
        document,
        maxAttempts: 2,
      }),
    ).rejects.toBeInstanceOf(AgentError);
    const changedShell = {
      ...document,
      shell: { ...document.shell, workspaceName: "Other" },
    };
    await expect(
      runPageAgent({
        provider: new MockProvider(() =>
          JSON.stringify({ mode: "document", document: changedShell }),
        ),
        messages: [{ role: "user", content: "x" }],
        document,
        maxAttempts: 1,
      }),
    ).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: expect.stringContaining("shell") }),
      ],
    });
  });

  it("documentToCommands + page.listDetail can remove business config", () => {
    const withList = pageProtocol().formTemplate;
    const plain = createDocument();
    const commands = documentToCommands(withList, plain);
    const applied = applyCommands(withList, commands);
    expect(applied.ok && applied.document).toEqual(plain);
    expect(validateDocument(plain)).toEqual([]);
    expect(extractJson('前缀 {"mode":"none"} 后缀')).toEqual({ mode: "none" });
  });
});

describe("sameOrigin", async () => {
  const { sameOrigin } = await import("../src/core/http");
  it("accepts the host the browser used and rejects other sites", () => {
    const req = (origin: string | null, host = "127.0.0.1:3100") =>
      new Request("http://localhost:3100/api/x", {
        method: "POST",
        headers: { host, ...(origin ? { origin } : {}) },
      });
    expect(sameOrigin(req("http://127.0.0.1:3100"))).toBe(true);
    expect(sameOrigin(req(null))).toBe(true);
    expect(sameOrigin(req("https://evil.example"))).toBe(false);
    expect(sameOrigin(req("not a url"))).toBe(false);
  });
});

describe("real DeepSeek output (deepseek-flash, 2026-10-05)", () => {
  it("accepts document + extra commands in one answer and keeps the business config", async () => {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(
      "tests/fixtures/deepseek-order-page.json",
      "utf8",
    );
    const document = createDocument();
    const result = await runPageAgent({
      provider: new MockProvider(() => raw),
      messages: [{ role: "user", content: "订单管理" }],
      document,
    });
    expect(result.attempts).toBe(1);
    expect(result.document.name).toBe("订单管理");
    expect(result.document.listDetail?.entityName).toBe("订单");
    expect(result.document.listDetail?.rows).toHaveLength(5);
    expect(validateDocument(result.document)).toEqual([]);
  });
});
