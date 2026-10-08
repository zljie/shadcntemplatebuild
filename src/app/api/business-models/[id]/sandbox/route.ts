import { runSandbox } from "@/server/business-model-ai";
import { readJson } from "@/core/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Body: {focus?: string, count?: number}. Infers sandbox scenarios with the built-in AI (rule-based without one). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await readJson(request, 10_000);
  if ("error" in parsed) return parsed.error;
  const { focus, count } = parsed.body;
  const result = await runSandbox((await params).id, {
    focus: typeof focus === "string" ? focus.trim().slice(0, 200) || undefined : undefined,
    count: typeof count === "number" ? count : undefined,
    signal: request.signal,
  });
  if (!result.ok) return Response.json({ error: result.message, problems: result.problems ?? [] }, { status: result.status });
  return Response.json({ added: result.added.map((s) => s.id), source: result.source, problems: result.problems, model: result.model }, { status: 201 });
}
