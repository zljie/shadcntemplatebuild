import { runRecordAction, runtimeConfig } from "@/server/ontology-store";
import { readJson } from "@/core/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ type: string }> };

export async function GET(_request: Request, { params }: Params) {
  const config = runtimeConfig((await params).type);
  return config ? Response.json({ rows: config.rows }) : Response.json({ error: "对象类型不存在" }, { status: 404 });
}

/** Body: {operationId, action: "record.create" | "record.update", recordId?, values}. Returns the shared RecordResult. */
export async function POST(request: Request, { params }: Params) {
  const parsed = await readJson(request, 200_000);
  if ("error" in parsed) return parsed.error;
  const result = runRecordAction((await params).type, parsed.body);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
