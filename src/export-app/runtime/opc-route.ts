/**
 * Server-side proxy to the opc-platform BFF (copied to src/app/api/opc/[...path]/route.ts).
 * Environment: DATA_MODE=bff|local (default local), OPC_BFF_URL, and for local development only
 * OPC_DEV_IDENTITY=1 with OPC_DEV_ACTOR / OPC_DEV_ROLES (the BFF must also run with OPC_DEV_IDENTITY=1).
 * Replace the identity part with your identity platform's token exchange before any real deployment.
 */
export const runtime = "nodejs";
type Params = { params: Promise<{ path: string[] }> };
const allowed: { method: string; path: RegExp }[] = [
  { method: "POST", path: /^api\/v1\/capabilities\/[A-Za-z0-9.]+\/execute$/ },
  { method: "GET", path: /^api\/v1\/executions\/[\w.:-]+$/ },
  { method: "POST", path: /^graphql$/ },
];

async function forward(request: Request, { params }: Params, method: "GET" | "POST") {
  const path = (await params).path.map(decodeURIComponent).join("/");
  if (method === "GET" && path === "mode") return Response.json({ mode: process.env.DATA_MODE === "bff" ? "bff" : "local", bff: !!process.env.OPC_BFF_URL });
  if (!allowed.some(r => r.method === method && r.path.test(path))) return Response.json({ error: "ROUTE_NOT_ALLOWED" }, { status: 403 });
  const base = process.env.OPC_BFF_URL?.replace(/\/+$/, "");
  if (process.env.DATA_MODE !== "bff" || !base) return Response.json({ error: "BFF_NOT_CONFIGURED", message: "设置 DATA_MODE=bff 和 OPC_BFF_URL 后重启" }, { status: 503 });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (process.env.OPC_DEV_IDENTITY === "1" && process.env.OPC_DEV_ACTOR) { headers["x-opc-actor"] = process.env.OPC_DEV_ACTOR; headers["x-opc-roles"] = process.env.OPC_DEV_ROLES ?? ""; }
  const key = request.headers.get("idempotency-key");
  if (key) headers["idempotency-key"] = key;
  try {
    const res = await fetch(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method, headers, body: method === "POST" ? await request.text() : undefined, signal: AbortSignal.timeout(15_000), cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch (error) {
    return Response.json({ error: "BFF_UNREACHABLE", message: `BFF 不可达：${error instanceof Error ? error.message : String(error)}` }, { status: 502 });
  }
}

export const GET = (request: Request, context: Params) => forward(request, context, "GET");
export const POST = (request: Request, context: Params) => forward(request, context, "POST");
