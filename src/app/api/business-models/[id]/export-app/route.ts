import { strToU8, zipSync } from "fflate";
import { exportApp } from "@/server/business-model-export";

export const runtime = "nodejs";

/** Downloads the generated app as a standalone Next.js frontend project (zip). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const exported = await exportApp(id);
  if (!exported.ok) return Response.json({ error: exported.message }, { status: exported.status });
  const mtime = new Date("2020-01-01T00:00:00Z");
  const zip = zipSync(Object.fromEntries(Object.entries(exported.value.files).map(([name, content]) => [name, [strToU8(content), { mtime }]])), { level: 6 });
  const name = `${id.replace(/[^a-zA-Z0-9_-]/g, "-")}-app.zip`;
  return new Response(new Uint8Array(zip), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${name}"` } });
}
