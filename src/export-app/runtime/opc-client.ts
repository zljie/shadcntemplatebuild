import type { CapabilityClient, CapabilityResult } from "@/runtime/opc";

/**
 * Client for the opc-platform BFF (OAF-005 decision D3): commands and queries through REST
 * `POST /api/v1/capabilities/:ref/execute`, list reads through the read-only GraphQL `capability(ref, input)`.
 * The browser calls this app's own /api/opc proxy (src/app/api/opc/[...path]/route.ts); the proxy adds the
 * server-side identity and forwards to OPC_BFF_URL, so no identity or BFF address lives in the browser.
 */
const isResult = (body: unknown): body is CapabilityResult => !!body && typeof body === "object" && "status" in body && "reasons" in body && "requestId" in body;
const failure = (body: unknown, status: number) => {
  const b = body as {message?: unknown; error?: unknown; errors?: {message?: unknown}[]} | null;
  return new Error(String(b?.message ?? b?.errors?.[0]?.message ?? b?.error ?? `HTTP ${status}`));
};
const capabilityQuery = "query Capability($ref: ID!, $input: JSON) { capability(ref: $ref, input: $input) { requestId traceId releaseId capabilityRef phase status data reasons { code message ruleId } evidenceRefs } }";

export function createOpcClient(base = "/api/opc", fetcher: typeof fetch = (...args) => fetch(...args)): CapabilityClient {
  async function call(path: string, init: RequestInit): Promise<{status: number; body: unknown}> {
    const res = await fetcher(`${base}/${path}`, {...init, cache: "no-store"});
    return {status: res.status, body: await res.json().catch(() => null)};
  }
  return {
    async execute(capabilityRef, input, {phase = "EXECUTE", idempotencyKey} = {}) {
      const {status, body} = await call(`api/v1/capabilities/${encodeURIComponent(capabilityRef)}/execute`, {
        method: "POST", headers: {"content-type": "application/json", ...(idempotencyKey ? {"idempotency-key": idempotencyKey} : {})}, body: JSON.stringify({phase, input}),
      });
      if (isResult(body)) return body;
      throw failure(body, status);
    },
    async query(capabilityRef, input) {
      const {status, body} = await call("graphql", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({query: capabilityQuery, variables: {ref: capabilityRef, input}})});
      const result = (body as {data?: {capability?: unknown}} | null)?.data?.capability;
      if (isResult(result)) return result;
      throw failure(body, status);
    },
    async execution(requestId) {
      const {status, body} = await call(`api/v1/executions/${encodeURIComponent(requestId)}`, {method: "GET"});
      if (status === 404) return null;
      if (isResult(body)) return body;
      throw failure(body, status);
    },
  };
}

export const opcClient = createOpcClient();
