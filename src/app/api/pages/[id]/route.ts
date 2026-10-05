import { deletePage, getPage, hydratedListDetailDocument, savePageDocument } from "@/server/ontology-store";
import { validateDocument } from "@/core/validation";
import { issuesResponse, readJson, sameOrigin } from "@/core/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** For list-detail pages the document carries live SQLite rows, ready for the composer. */
export async function GET(_request: Request, { params }: Params) {
  const page = getPage((await params).id);
  if (!page) return Response.json({ error: "页面不存在" }, { status: 404 });
  const hydrated = page.kind === "list-detail" ? hydratedListDetailDocument(page.objectType) : null;
  // Fall back to the stored snapshot when live data exceeds DSL limits (200 rows, 30 options).
  const document = hydrated && !validateDocument(hydrated).length ? hydrated : page.document;
  return Response.json({ page: { ...page, document } });
}

export async function PUT(request: Request, { params }: Params) {
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;
  const result = savePageDocument((await params).id, parsed.body.document);
  return result.ok ? Response.json({ page: result.value }) : issuesResponse(result.errors);
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameOrigin(request)) return Response.json({ error: "跨站请求被拒绝" }, { status: 403 });
  return deletePage((await params).id) ? Response.json({ deleted: true }) : Response.json({ error: "页面不存在" }, { status: 404 });
}
