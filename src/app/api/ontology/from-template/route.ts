import { getTemplate } from "@/core/templates";
import { importTemplateAsType } from "@/server/ontology-store";
import { issuesResponse, readJson } from "@/core/http";

export const runtime = "nodejs";

/** Body: {templateId, apiName}. Creates an object type + records from a list/detail template and generates its pages. */
export async function POST(request: Request) {
  const parsed = await readJson(request, 10_000);
  if ("error" in parsed) return parsed.error;
  const template = await getTemplate(String(parsed.body.templateId ?? ""));
  if (!template) return Response.json({ error: "模板不存在" }, { status: 404 });
  const result = importTemplateAsType(template.document, String(parsed.body.apiName ?? ""), template.description);
  return result.ok ? Response.json({ objectType: result.value }) : issuesResponse(result.errors);
}
