import { createMcpHandler } from "@modelcontextprotocol/server";
import { createPageServer } from "@/mcp/tools";

export const runtime = "nodejs";

/**
 * Streamable HTTP MCP endpoint: point any MCP client at <origin>/api/mcp.
 * Set MCP_TOKEN to require `Authorization: Bearer <token>` (recommended for any non-local deployment).
 * export_project is STDIO-only; save_template writes to TEMPLATES_DIR on this server.
 */
const handlers = new Map<string, ReturnType<typeof createMcpHandler>>();
function handler(request: Request) {
  const base =
    process.env.REGISTRY_BASE_URL?.replace(/\/$/, "") ??
    new URL(request.url).origin;
  let existing = handlers.get(base);
  if (!existing) {
    existing = createMcpHandler(
      () => createPageServer({ local: false, registryBaseUrl: base }),
      { responseMode: "json" },
    );
    handlers.set(base, existing);
  }
  return existing;
}
async function serve(request: Request) {
  const token = process.env.MCP_TOKEN;
  if (token && request.headers.get("authorization") !== `Bearer ${token}`)
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": "Bearer",
      },
    });
  return handler(request).fetch(request);
}
export { serve as GET, serve as POST, serve as DELETE };
