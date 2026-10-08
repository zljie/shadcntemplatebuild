import { importBusinessModel, listBusinessModels, summarize } from "@/server/business-model-store";
import { issuesResponse, readJson } from "@/core/http";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ models: listBusinessModels() });
}

/** Body: {yaml: string, fileName?: string}. Imports an ontology YAML as a new business model. */
export async function POST(request: Request) {
  const parsed = await readJson(request, 3_000_000);
  if ("error" in parsed) return parsed.error;
  const { yaml, fileName } = parsed.body;
  if (typeof yaml !== "string" || !yaml.trim()) return issuesResponse([{ path: "yaml", message: "请提供 YAML 内容" }]);
  const result = importBusinessModel(yaml, typeof fileName === "string" ? fileName : "model.yaml");
  if (!result.ok) return issuesResponse(result.issues, 422);
  return Response.json({ model: summarize(result.value), issues: result.value.issues }, { status: 201 });
}
