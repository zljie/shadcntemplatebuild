import { NextResponse } from "next/server";
import { deleteTemplate, getTemplate } from "@/core/templates";
import { sameOrigin } from "@/core/http";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const template = await getTemplate((await params).id);
  return template
    ? NextResponse.json({ template })
    : NextResponse.json({ error: "模板不存在" }, { status: 404 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  return (await deleteTemplate((await params).id))
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: "模板不存在" }, { status: 404 });
}
