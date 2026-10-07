import { NextResponse } from "next/server";
import { z } from "zod";
import { runPageAgent, AgentError, maxContextLength, type AgentEvent } from "@/ai/page-agent";
import { getProvider, providerStatus } from "@/llm/registry";
import { LLMError } from "@/llm/types";
import { validateDocument } from "@/core/validation";
import { upgradeDocument } from "@/core/migrations";
import { sameOrigin } from "@/core/http";
import type { PageDocument } from "@/core/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(8000),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    document: z.unknown(),
    thinking: z.boolean().optional(),
    context: z.string().max(maxContextLength).optional(),
  })
  .strict();

/** Provider status for the chat panel (no secrets). */
export async function GET() {
  return NextResponse.json(providerStatus());
}

/**
 * Chat → page. Responds with NDJSON events:
 *   {type:"status"|"attempt"|"progress"|"reasoning"|"issues", ...}
 *   {type:"result", reply, mode, command?, document, attempts, usage, model}
 *   {type:"error", message, errors?}
 */
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const text = await request.text();
  if (text.length > 2_500_000)
    return NextResponse.json({ error: "请求超过大小限制" }, { status: 413 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(text));
  } catch (error) {
    return NextResponse.json(
      { error: `无效请求：${error instanceof Error ? error.message : ""}` },
      { status: 400 },
    );
  }
  body.document = upgradeDocument(body.document);
  const documentErrors = validateDocument(body.document);
  if (documentErrors.length)
    return NextResponse.json(
      { error: "当前页面 DSL 无效，请先修复", errors: documentErrors },
      { status: 400 },
    );
  if (body.messages.at(-1)?.role !== "user")
    return NextResponse.json(
      { error: "最后一条消息必须来自用户" },
      { status: 400 },
    );

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "模型未配置" },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
        } catch {
          /* client went away */
        }
      };
      let lastProgress = 0;
      const onEvent = (event: AgentEvent) => {
        if (event.type === "progress") {
          if (event.characters - lastProgress < 400) return; // throttle
          lastProgress = event.characters;
        }
        send(event);
      };
      try {
        const result = await runPageAgent({
          provider,
          messages: body.messages,
          document: body.document as PageDocument,
          context: body.context?.trim() || process.env.AI_BUSINESS_CONTEXT,
          thinking: body.thinking ?? process.env.LLM_THINKING === "true",
          signal: request.signal,
          onEvent,
        });
        send({ type: "result", ...result });
      } catch (error) {
        if (error instanceof AgentError)
          send({ type: "error", message: error.message, errors: error.errors });
        else if (error instanceof LLMError)
          send({ type: "error", message: error.message, status: error.status });
        else
          send({
            type: "error",
            message: error instanceof Error ? error.message : "生成失败",
          });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
