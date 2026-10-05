/**
 * Rejects browser requests from another origin. Compares the Origin header with the Host the
 * request was actually sent to (Next normalises request.url to "localhost", so comparing with
 * request.url wrongly rejects http://127.0.0.1:3100).
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    new URL(request.url).host,
  ].filter(Boolean);
  return hosts.includes(originHost);
}

/** Parses a bounded JSON body; returns a Response on failure. */
export async function readJson(request: Request, limit = 2_000_000): Promise<{ body: Record<string, unknown> } | { error: Response }> {
  if (!sameOrigin(request)) return { error: Response.json({ error: "跨站请求被拒绝" }, { status: 403 }) };
  const text = await request.text();
  if (text.length > limit) return { error: Response.json({ error: "请求体过大" }, { status: 413 }) };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return { body };
  } catch {
    return { error: Response.json({ error: "无效 JSON" }, { status: 400 }) };
  }
}

export const issuesResponse = (errors: { path: string; message: string }[], status = 400) =>
  Response.json({ error: errors.map((e) => `${e.path}: ${e.message}`).join("；"), errors }, { status });
