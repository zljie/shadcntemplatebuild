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
