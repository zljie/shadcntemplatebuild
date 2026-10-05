import { deleteObject, getObject, incomingLinks } from "@/server/ontology-store";
import { sameOrigin } from "@/core/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ type: string; id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { type, id } = await params;
  const found = getObject(type, id);
  return found ? Response.json({ record: found.record, links: incomingLinks(type, id) }) : Response.json({ error: "记录不存在" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!sameOrigin(request)) return Response.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const { type, id } = await params;
  return deleteObject(type, id) ? Response.json({ deleted: true }) : Response.json({ error: "记录不存在" }, { status: 404 });
}
