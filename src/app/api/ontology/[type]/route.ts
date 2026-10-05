import { deleteObjectType, getObjectType, runtimeConfig } from "@/server/ontology-store";
import { issuesResponse, sameOrigin } from "@/core/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ type: string }> };

export async function GET(_request: Request, { params }: Params) {
  const apiName = (await params).type;
  const type = getObjectType(apiName);
  if (!type) return Response.json({ error: "对象类型不存在" }, { status: 404 });
  const config = runtimeConfig(apiName)!;
  return Response.json({ type, config: { ...config, rows: undefined }, count: config.rows.length });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameOrigin(request)) return Response.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const result = deleteObjectType((await params).type);
  return result.ok ? Response.json({ deleted: true }) : issuesResponse(result.errors, 409);
}
