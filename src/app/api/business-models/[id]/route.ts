import { deleteBusinessModel, getBusinessModel, updateBusinessModel } from "@/server/business-model-store";
import { issuesResponse, readJson, sameOrigin } from "@/core/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const stored = getBusinessModel((await params).id);
  return stored ? Response.json(stored) : Response.json({ error: "业务模型不存在" }, { status: 404 });
}

/** Body: {patches: ModelPatch[]}. Applied atomically; ids are never rewritten. */
export async function PATCH(request: Request, { params }: Params) {
  const parsed = await readJson(request, 200_000);
  if ("error" in parsed) return parsed.error;
  const { patches } = parsed.body;
  if (!Array.isArray(patches) || !patches.length) return issuesResponse([{ path: "patches", message: "需要至少一项修改" }]);
  const result = updateBusinessModel((await params).id, patches);
  return result.ok ? Response.json(result.value) : issuesResponse(result.issues, result.issues[0]?.path === "id" ? 404 : 400);
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameOrigin(request)) return Response.json({ error: "跨站请求被拒绝" }, { status: 403 });
  return deleteBusinessModel((await params).id) ? Response.json({ deleted: true }) : Response.json({ error: "业务模型不存在" }, { status: 404 });
}
