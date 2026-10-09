import type { CapabilityResult } from "../runtime/opc";
import { getDatabase } from "./db";

/**
 * Server-side access to opc-platform (OAF-005): meta-data (catalogs, releases), db-connect (mapping compile,
 * readiness) and the BFF (capabilities). Base URLs come from the environment only; pages never call the
 * services directly, they go through /api/opc/<service>/… which allowlists the routes below.
 */
export const services = ["meta-data", "db-connect", "bff"] as const;
export type Service = (typeof services)[number];
const envNames: Record<Service, string> = { "meta-data": "OPC_META_DATA_URL", "db-connect": "OPC_DB_CONNECT_URL", bff: "OPC_BFF_URL" };

export type OpcConfig = {
  urls: Partial<Record<Service, string>>; missing: string[]; app: string | null;
  /** Development identity (OPC_DEV_IDENTITY=1): x-opc-* headers chosen in the composer are forwarded to the BFF. */
  devIdentity: boolean; defaultIdentity: { actor: string; roles: string } | null;
};
export function opcConfig(env: NodeJS.ProcessEnv = process.env): OpcConfig {
  const urls: OpcConfig["urls"] = {}, missing: string[] = [];
  for (const service of services) {
    const value = env[envNames[service]]?.trim().replace(/\/+$/, "");
    if (value) urls[service] = value; else missing.push(envNames[service]);
  }
  if (!env.OPC_APP) missing.push("OPC_APP");
  const devIdentity = env.OPC_DEV_IDENTITY === "1";
  return {
    urls, missing, app: env.OPC_APP?.trim() || null, devIdentity,
    defaultIdentity: devIdentity && env.OPC_DEV_ACTOR ? { actor: env.OPC_DEV_ACTOR, roles: env.OPC_DEV_ROLES ?? "" } : null,
  };
}

/** Routes the composer may reach, per service. Anything else is refused by the proxy. */
const allow: Record<Service, { method: "GET" | "POST"; path: RegExp }[]> = {
  "meta-data": [
    { method: "GET", path: /^health$/ },
    { method: "GET", path: /^releases\/rel_[\w-]+$/ },
    { method: "POST", path: /^releases$/ },
    { method: "POST", path: /^releases\/rel_[\w-]+\/activate$/ },
    { method: "GET", path: /^apps\/[\w.-]+\/active-release$/ },
    { method: "GET", path: /^(operations|capabilities)$/ },
    { method: "GET", path: /^mappings\/[\w.-]+$/ },
  ],
  "db-connect": [
    { method: "GET", path: /^health$/ },
    { method: "POST", path: /^releases\/rel_[\w-]+\/prepare$/ },
    { method: "POST", path: /^mappings\/[\w.-]+\/compile$/ },
  ],
  bff: [
    { method: "GET", path: /^health$/ },
    { method: "POST", path: /^releases\/rel_[\w-]+\/prepare$/ },
    { method: "POST", path: /^reload$/ },
    { method: "POST", path: /^api\/v1\/capabilities\/[A-Za-z0-9.]+\/execute$/ },
    { method: "GET", path: /^api\/v1\/executions\/[\w.:-]+$/ },
    { method: "POST", path: /^graphql$/ },
  ],
};
export const isAllowed = (service: Service, method: string, path: string) => allow[service].some(r => r.method === method && r.path.test(path));

export type Identity = { actor: string; roles: string };
export type ServiceResponse<T = unknown> = { ok: boolean; status: number; body: T };

export async function callService<T = unknown>(service: Service, method: "GET" | "POST", path: string, options: {
  body?: unknown; search?: string; identity?: Identity | null; idempotencyKey?: string | null; config?: OpcConfig; timeoutMs?: number;
} = {}): Promise<ServiceResponse<T>> {
  const config = options.config ?? opcConfig(), base = config.urls[service];
  if (!base) return { ok: false, status: 503, body: { error: "NOT_CONFIGURED", message: `未配置 ${envNames[service]}` } as T };
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (service === "bff" && config.devIdentity) {
    // undefined → the configured default dev identity; null → explicitly anonymous.
    const identity = options.identity === undefined ? config.defaultIdentity : options.identity;
    if (identity?.actor) { headers["x-opc-actor"] = identity.actor; headers["x-opc-roles"] = identity.roles; }
  }
  if (service === "bff" && options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  try {
    const res = await fetch(`${base}/${path}${options.search ?? ""}`, {
      method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000), cache: "no-store",
    });
    const text = await res.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    if (res.ok && service === "meta-data") rememberRelease(body);
    return { ok: res.ok, status: res.status, body: body as T };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, status: timeout ? 504 : 502, body: { error: timeout ? "TIMEOUT" : "UNREACHABLE", message: `${service} ${timeout ? "超时" : "不可达"}：${base}` } as T };
  }
}

// ── Known releases ───────────────────────────────────────────────────────────
// meta-data has no "list releases" route (and keeps them in memory), so the composer remembers every
// release id it has seen. Ids whose release no longer exists show up as missing in the release center.
const releaseTable = "create table if not exists opc_releases(id text primary key, app text not null, created_at text not null, seen_at text not null)";
function rememberRelease(body: unknown) {
  if (!body || typeof body !== "object") return;
  const release = body as { id?: unknown; app?: unknown; createdAt?: unknown };
  if (typeof release.id !== "string" || !release.id.startsWith("rel_") || typeof release.app !== "string") return;
  try {
    const db = getDatabase(); db.exec(releaseTable);
    db.prepare(`insert into opc_releases(id, app, created_at, seen_at) values (?, ?, ?, ?) on conflict(id) do update set seen_at = excluded.seen_at`)
      .run(release.id, release.app, typeof release.createdAt === "string" ? release.createdAt : new Date().toISOString(), new Date().toISOString());
  } catch { /* remembering is best effort */ }
}
export function knownReleases(app: string): { id: string; createdAt: string }[] {
  const db = getDatabase(); db.exec(releaseTable);
  return (db.prepare("select id, created_at from opc_releases where app = ? order by created_at desc limit 50").all(app) as { id: string; created_at: string }[])
    .map(r => ({ id: r.id, createdAt: r.created_at }));
}

// ── Typed reads used by the server-rendered pages ────────────────────────────
export type Readiness = { ready: boolean; blockers: string[]; contractVersion: string; reportedAt: string };
export type PackageRef = { id: string; version: string };
export type Operation = {
  operationId: string; version: string; packageRef: PackageRef; mappingId: string; actionId: string; entityId: string;
  operationType: "query" | "mutation"; kind: string; document: string; documentSha256: string; variablesSchema: Record<string, unknown>;
  authorization: { roles: string[]; tenantScope: string }; queryLimits: { maxRows: number; maxDepth: number }; status: "approved" | "disabled";
};
export type Capability = {
  capabilityRef: string; packageRef: PackageRef; kind: "query" | "command"; title?: string; allowedRoles: string[];
  inputSchema?: Record<string, unknown>; outputSchema?: Record<string, unknown>;
  handler: { type: "operation"; operationId: string } | { type: "script"; module: string; sha256?: string; dependencies: { operations: string[]; commands: string[]; policies: string[] } };
};
export type MappedEntity = { entityId: string; table: string; columns: Record<string, string>; allowedOperations: string[]; relationships: { name: string; kind: string; target: string; fieldMapping: Record<string, string> }[]; tenantField?: string };
export type DataMapping = { id: string; packageRef: PackageRef; connectionRef: string; hasuraSource: string; entities: MappedEntity[] };
export type Binding = { id: string; actionId: string; executor: { id: string; version: string }; mappingId: string; policies: string[] };
export type Release = {
  id: string; app: string; contractVersion: string; packageRef: PackageRef; packageDigest: string; actions: string[];
  bindings: Binding[]; mappings: DataMapping[]; operations: Operation[]; capabilities: Capability[]; manifestDigest: string;
  blockers: string[]; readiness: Partial<Record<"bff" | "db-connect", Readiness>>;
  status: "BLOCKED" | "PENDING_READINESS" | "READY" | "ACTIVE" | "SUPERSEDED"; createdAt: string; activatedAt?: string;
};
export type Health = { service: Service; ok: boolean; status: number; detail: Record<string, unknown> | null; message?: string };

export async function healthAll(config = opcConfig()): Promise<Health[]> {
  return Promise.all(services.map(async service => {
    const res = await callService<Record<string, unknown>>(service, "GET", "health", { config, timeoutMs: 3000 });
    return { service, ok: res.ok, status: res.status, detail: res.ok ? res.body : null, ...(res.ok ? {} : { message: String((res.body as { message?: unknown })?.message ?? res.status) }) };
  }));
}
export async function activeRelease(config = opcConfig()): Promise<Release | null> {
  if (!config.app) return null;
  const res = await callService<Release>("meta-data", "GET", `apps/${encodeURIComponent(config.app)}/active-release`, { config });
  return res.ok ? res.body : null;
}
export async function getRelease(id: string, config = opcConfig()): Promise<Release | null> {
  const res = await callService<Release>("meta-data", "GET", `releases/${encodeURIComponent(id)}`, { config });
  return res.ok ? res.body : null;
}
export async function listOperations(pkg: PackageRef, config = opcConfig()): Promise<Operation[] | null> {
  const res = await callService<Operation[]>("meta-data", "GET", "operations", { config, search: `?package=${encodeURIComponent(`${pkg.id}@${pkg.version}`)}` });
  return res.ok && Array.isArray(res.body) ? res.body : null;
}

const capabilityQuery = "query Capability($ref: ID!, $input: JSON) { capability(ref: $ref, input: $input) { requestId traceId releaseId capabilityRef phase status data reasons { code message ruleId } evidenceRefs } }";
/** Runs a query capability through the BFF's read-only GraphQL with the configured default identity. */
export async function queryCapability(capabilityRef: string, input: Record<string, unknown>, config = opcConfig()): Promise<{ ok: true; result: CapabilityResult } | { ok: false; message: string }> {
  const res = await callService<{ data?: { capability?: CapabilityResult }; errors?: { message: string }[]; message?: string }>("bff", "POST", "graphql", { config, body: { query: capabilityQuery, variables: { ref: capabilityRef, input } } });
  const result = res.body?.data?.capability;
  return result ? { ok: true, result } : { ok: false, message: res.body?.errors?.[0]?.message ?? res.body?.message ?? `HTTP ${res.status}` };
}
