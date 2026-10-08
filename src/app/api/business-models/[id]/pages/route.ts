import { createPagesForEntity } from "@/server/business-model-store";
import { issuesResponse, readJson } from "@/core/http";

export const runtime = "nodejs";

/** Body: {entity}. Projects the entity into an ontology object type and generates its pages. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = await readJson(request, 10_000);
  if ("error" in parsed) return parsed.error;
  const result = createPagesForEntity((await params).id, String(parsed.body.entity ?? ""));
  if (!result.ok) return issuesResponse(result.issues);
  const { objectType, pages, skipped } = result.value;
  return Response.json({ objectType, pages, skipped }, { status: 201 });
}
