import { getBusinessModel } from "@/server/business-model-store";
import { toYaml } from "@/business-model/model";

export const runtime = "nodejs";

/** Downloads the current model as YAML in the source format (unknown keys preserved). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const stored = getBusinessModel((await params).id);
  if (!stored) return Response.json({ error: "业务模型不存在" }, { status: 404 });
  return new Response(toYaml(stored.model), {
    headers: { "Content-Type": "application/yaml; charset=utf-8", "Content-Disposition": `attachment; filename="${stored.id}.yaml"` },
  });
}
