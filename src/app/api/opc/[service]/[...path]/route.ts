import { sameOrigin } from "@/core/http";
import { callService, isAllowed, opcConfig, services, type Service } from "@/server/opc-platform";

export const runtime = "nodejs";
type Params = { params: Promise<{ service: string; path: string[] }> };

/**
 * Server-side proxy from composer pages to opc-platform. Only allowlisted routes pass (see opc-platform.ts);
 * base URLs come from OPC_* environment variables. With OPC_DEV_IDENTITY=1 the development identity
 * chosen in the page (x-opc-actor / x-opc-roles) is forwarded to the BFF, otherwise none is.
 */
async function proxy(request: Request, { params }: Params, method: "GET" | "POST") {
  if (!sameOrigin(request)) return Response.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const { service, path } = await params;
  if (!services.includes(service as Service)) return Response.json({ error: "UNKNOWN_SERVICE" }, { status: 404 });
  const joined = path.map(decodeURIComponent).join("/");
  if (!isAllowed(service as Service, method, joined)) return Response.json({ error: "ROUTE_NOT_ALLOWED", message: `${method} ${service}/${joined} 不在允许列表中` }, { status: 403 });
  let body: unknown;
  if (method === "POST") {
    const text = await request.text();
    if (text.length > 1_000_000) return Response.json({ error: "请求体过大" }, { status: 413 });
    try { body = text ? JSON.parse(text) : undefined; } catch { return Response.json({ error: "无效 JSON" }, { status: 400 }); }
  }
  const config = opcConfig(), actor = request.headers.get("x-opc-actor");
  const result = await callService(service as Service, method, joined.split("/").map(encodeURIComponent).join("/"), {
    config, body, search: new URL(request.url).search,
    identity: actor ? { actor, roles: request.headers.get("x-opc-roles") ?? "" } : request.headers.get("x-opc-anonymous") === "1" ? null : undefined,
    idempotencyKey: request.headers.get("idempotency-key"),
  });
  return Response.json(result.body, { status: result.status });
}

export const GET = (request: Request, context: Params) => proxy(request, context, "GET");
export const POST = (request: Request, context: Params) => proxy(request, context, "POST");
