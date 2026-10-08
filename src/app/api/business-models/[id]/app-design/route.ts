import { runAppDesign } from "@/server/business-model-ai";
import { sameOrigin } from "@/core/http";

export const runtime = "nodejs";
export const maxDuration = 300;

/** One-click conversion: AI app-design plan → object types, sample records and pages. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const result = await runAppDesign((await params).id, { signal: request.signal });
  if (!result.ok) return Response.json({ error: result.message, problems: result.problems ?? [] }, { status: result.status });
  return Response.json({ design: result.design, model: result.model }, { status: 201 });
}
