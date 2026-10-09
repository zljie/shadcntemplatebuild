/** Browser → /api/opc/<service>/… (server-side proxy to opc-platform). */
export type DevIdentity = {actor: string; roles: string};
export type OpcResponse<T> = {ok: boolean; status: number; body: T};

export async function opc<T = unknown>(service: "meta-data" | "db-connect" | "bff", path: string, options: {
  method?: "GET" | "POST"; body?: unknown; identity?: DevIdentity | null; idempotencyKey?: string;
} = {}): Promise<OpcResponse<T>> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.identity) { headers["x-opc-actor"] = options.identity.actor; headers["x-opc-roles"] = options.identity.roles; }
  else if (options.identity === null) headers["x-opc-anonymous"] = "1";
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  const res = await fetch(`/api/opc/${service}/${path}`, {method: options.method ?? "GET", headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)});
  const body = await res.json().catch(() => null);
  return {ok: res.ok, status: res.status, body: body as T};
}

export const errorText = (body: unknown, status: number) => {
  const b = body as {message?: unknown; error?: unknown; problems?: unknown; blockers?: unknown} | null;
  const extra = Array.isArray(b?.problems) ? `：${b.problems.join("；")}` : Array.isArray(b?.blockers) && b.blockers.length ? `：${b.blockers.join("；")}` : "";
  return `${String(b?.message ?? b?.error ?? `HTTP ${status}`)}${extra}`;
};

/** Development identities from the campus_library seed data (opc-platform executors/library). */
export const devIdentities: {label: string; identity: DevIdentity | null}[] = [
  {label: "王馆员 · LIBRARIAN", identity: {actor: "u_librarian", roles: "LIBRARIAN"}},
  {label: "李同学 · READER", identity: {actor: "u_reader", roles: "READER"}},
  {label: "张同学（停用）· READER", identity: {actor: "u_suspended", roles: "READER"}},
  {label: "未登录", identity: null},
];
