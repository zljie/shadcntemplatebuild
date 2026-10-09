import { issuesResponse, readJson } from "@/core/http";
import { bindPage } from "@/server/platform-bindings";
import { activeRelease, getRelease } from "@/server/opc-platform";

export const runtime = "nodejs";

/** Body: {pageId, releaseId?, mode?: "bind" | "unbind"}. Binds a list/detail page DSL to the release's capabilities (default: active release). */
export async function POST(request: Request) {
  const parsed = await readJson(request, 10_000);
  if ("error" in parsed) return parsed.error;
  const {pageId, releaseId, mode} = parsed.body;
  const release = typeof releaseId === "string" && releaseId ? await getRelease(releaseId) : await activeRelease();
  if (!release) return Response.json({error: "没有可用的发布（meta-data 不可达或尚未启用）"}, {status: 409});
  const result = bindPage(release, String(pageId ?? ""), mode === "unbind" ? "unbind" : "bind");
  return result.ok ? Response.json({...result.value, releaseId: release.id}) : issuesResponse(result.errors, 422);
}
