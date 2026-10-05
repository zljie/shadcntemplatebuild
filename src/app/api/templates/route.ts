import { NextResponse } from "next/server";
import { listTemplates, saveTemplate, withoutDocument } from "@/core/templates";
import { sameOrigin } from "@/core/http";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ templates: await listTemplates() });
}

export async function POST(request: Request) {
  if (!sameOrigin(request))
    return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const text = await request.text();
  if (text.length > 2_000_000)
    return NextResponse.json({ error: "模板超过 2 MB 限制" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "无效 JSON" }, { status: 400 });
  }
  const result = await saveTemplate({
    id: String(body.id ?? ""),
    name: String(body.name ?? ""),
    description: typeof body.description === "string" ? body.description : "",
    tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    document: body.document,
    source: body.source === "ai" ? "ai" : "builder",
  });
  if (!result.ok)
    return NextResponse.json(
      {
        error: result.errors.map((e) => `${e.path}: ${e.message}`).join("；"),
        errors: result.errors,
      },
      { status: 400 },
    );
  return NextResponse.json({ template: withoutDocument(result.template) });
}
