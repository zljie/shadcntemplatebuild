import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpcClient } from "../src/export-app/runtime/opc-client";
import { manifest } from "../src/export-app/runtime/modules";
import { BffRepository, type Repository } from "../src/export-app/runtime/repository";
import { ResourceDetails, RuntimeProvider } from "../src/runtime/components";
import type { ListDetail } from "../src/runtime/data";
import { resolveArguments, rowsFromResult, type CapabilityClient, type CapabilityResult, type CommandAction } from "../src/runtime/opc";
import { callService, isAllowed, opcConfig } from "../src/server/opc-platform";

const result = (over: Partial<CapabilityResult> = {}): CapabilityResult => ({
  requestId: "req_1", traceId: "trace_1", releaseId: "rel_1", capabilityRef: "BookCopy.List", phase: "EXECUTE", status: "SUCCEEDED", data: [], reasons: [], evidenceRefs: [], ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const config: ListDetail = {
  entityName: "副本", titleField: "barcode", columns: [{ field: "barcode", title: "条码" }], searchFields: ["barcode"], filters: [], detailFields: ["status"],
  fields: [{ key: "barcode", label: "条码", type: "text" }, { key: "status", label: "状态", type: "text" }, { key: "title", label: "书名", type: "text" }, { key: "copies", label: "册数", type: "number" }],
  dataSource: { type: "capability", capabilityRef: "BookCopy.List", input: { limit: 20 }, idField: "copy_id", fieldPaths: { title: "title.title" } }, rows: [],
};
const borrow: CommandAction = {
  event: "record.command", capabilityRef: "Library.Borrow", label: "办理借出", confirm: true,
  arguments: { copyId: { from: "row", field: "id" }, readerId: { from: "form", label: "读者编号", type: "text", required: true }, channel: { from: "const", value: "desk" } },
  result: { onSuccess: { refresh: true }, onRejected: {} },
};

describe("opc-client (BFF over REST + read-only GraphQL)", () => {
  it("executes commands with phase and Idempotency-Key, and returns rejections as results", async () => {
    const fetcher = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => json(result({ capabilityRef: "Library.Borrow", status: "REJECTED", reasons: [{ code: "LOAN_LIMIT", message: "超出借阅上限" }] })));
    const client = createOpcClient("/api/opc", fetcher as typeof fetch);
    const answer = await client.execute("Library.Borrow", { readerId: "u_reader", copyId: "c1" }, { phase: "EXECUTE", idempotencyKey: "idem-1" });
    expect(answer.status).toBe("REJECTED");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/opc/api/v1/capabilities/Library.Borrow/execute");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["idempotency-key"]).toBe("idem-1");
    expect(JSON.parse(String(init?.body))).toEqual({ phase: "EXECUTE", input: { readerId: "u_reader", copyId: "c1" } });
  });

  it("throws transport and protocol errors instead of inventing results", async () => {
    const client = createOpcClient("/x", (async () => json({ error: "IDEMPOTENCY_KEY_REQUIRED", message: "command EXECUTE needs an Idempotency-Key header" }, 400)) as typeof fetch);
    await expect(client.execute("Library.Borrow", {})).rejects.toThrow("Idempotency-Key");
    const graphqlError = createOpcClient("/x", (async () => json({ errors: [{ message: "authentication required" }] })) as typeof fetch);
    await expect(graphqlError.query("BookCopy.List", {})).rejects.toThrow("authentication required");
  });

  it("reads lists through the GraphQL capability query and looks up executions", async () => {
    const fetcher = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(async url => String(url).endsWith("graphql")
      ? json({ data: { capability: result({ data: [{ copy_id: "c1" }] }) } }) : String(url).includes("missing") ? json({ error: "NOT_FOUND" }, 404) : json(result({ status: "PENDING" })));
    const client = createOpcClient("/api/opc", fetcher as typeof fetch);
    expect((await client.query("BookCopy.List", { limit: 5 })).data).toEqual([{ copy_id: "c1" }]);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.query).toContain("capability(ref: $ref, input: $input)");
    expect(body.variables).toEqual({ ref: "BookCopy.List", input: { limit: 5 } });
    expect((await client.execution("req_9"))?.status).toBe("PENDING");
    expect(await client.execution("missing")).toBeNull();
  });
});

describe("BFF-backed Repository", () => {
  const local: Repository = { list: vi.fn(async () => [{ id: "seed" }]), submit: vi.fn(async () => ({ ok: true as const, record: { id: "x" }, rows: [] })), remove: vi.fn(async () => true) };
  beforeEach(() => {
    manifest.modules.splice(0, manifest.modules.length,
      { key: "book-copy", title: "副本", entity: "book_copy", objectType: "t", config, links: {}, seed: [], actions: [] },
      { key: "note", title: "备注", entity: "note", objectType: "n", config: { ...config, dataSource: "example" }, links: {}, seed: [], actions: [] });
  });

  it("maps capability rows to records (id field, nested paths, types) and keeps local modules local", async () => {
    const client: CapabilityClient = {
      query: vi.fn(async () => result({ data: [{ copy_id: "c1", barcode: "B1", status: "AVAILABLE", title: { title: "SICP" }, copies: "3" }, { barcode: "no id" }] })),
      execute: vi.fn(), execution: vi.fn(),
    };
    const repo = new BffRepository(client, local);
    expect(await repo.list("book-copy")).toEqual([{ id: "c1", barcode: "B1", status: "AVAILABLE", title: "SICP", copies: 3 }]);
    expect(client.query).toHaveBeenCalledWith("BookCopy.List", { limit: 20 });
    expect(await repo.list("note")).toEqual([{ id: "seed" }]);
    expect((await repo.submit("book-copy", {})).ok).toBe(false);
    expect(await repo.remove("book-copy", "c1")).toBe(false);
    await repo.submit("note", {});
    expect(local.submit).toHaveBeenCalled();
  });

  it("surfaces a rejected list read as an error", async () => {
    const client = { query: async () => result({ status: "REJECTED", reasons: [{ code: "FORBIDDEN", message: "角色无权访问" }] }), execute: vi.fn(), execution: vi.fn() } as unknown as CapabilityClient;
    await expect(new BffRepository(client, local).list("book-copy")).rejects.toThrow("BookCopy.List REJECTED：角色无权访问");
  });

  it("resolves command arguments from the row, the form and constants", () => {
    expect(resolveArguments(borrow, { id: "c1" }, { readerId: " u_reader " })).toEqual({ input: { copyId: "c1", readerId: "u_reader", channel: "desk" }, missing: [] });
    expect(resolveArguments(borrow, { id: "c1" }, {}).missing).toEqual(["读者编号"]);
    expect(rowsFromResult({ rows: [{ copy_id: 7 }] }, { type: "capability", capabilityRef: "A.B", input: {}, idField: "copy_id" }, [])).toEqual([{ id: "7" }]);
  });

  it("offers business commands only with a capability client", () => {
    const listDetail = { ...config, rows: [{ id: "c1", barcode: "B1", status: "AVAILABLE", title: "SICP", copies: 1 }] };
    // eslint-disable-next-line react/no-children-prop -- RuntimeProvider types children as a required prop
    const render = (capability?: CapabilityClient) => renderToStaticMarkup(createElement(RuntimeProvider, {
      listDetail, initialSelectedId: "c1", adapter: { label: "BFF", submit: async () => ({ ok: false as const, errors: [], message: "" }), ...(capability ? { capability } : {}) },
      children: createElement(ResourceDetails, { commands: [borrow] }),
    }));
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*title="连接 BFF 后可执行业务命令"[^>]*>办理借出<\/button>/);
    expect(render({ query: vi.fn(), execute: vi.fn(), execution: vi.fn() })).toMatch(/<button(?![^>]*disabled="")[^>]*title="Library.Borrow"[^>]*>办理借出<\/button>/);
  });
});

describe("composer proxy to opc-platform", () => {
  it("takes base URLs from the environment only and allowlists routes", async () => {
    const empty = opcConfig({} as NodeJS.ProcessEnv);
    expect(empty.missing).toEqual(["OPC_META_DATA_URL", "OPC_DB_CONNECT_URL", "OPC_BFF_URL", "OPC_APP"]);
    expect((await callService("bff", "GET", "health", { config: empty })).status).toBe(503);
    expect(isAllowed("bff", "POST", "api/v1/capabilities/Library.Borrow/execute")).toBe(true);
    expect(isAllowed("meta-data", "POST", "releases/rel_1/activate")).toBe(true);
    expect(isAllowed("meta-data", "PUT", "capabilities")).toBe(false);
    expect(isAllowed("db-connect", "POST", "commands")).toBe(false);
    expect(isAllowed("bff", "POST", "api/v1/capabilities/../../x/execute")).toBe(false);
  });

  it("forwards the development identity only when enabled, and the idempotency key", async () => {
    const seen: Record<string, string>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => { seen.push(init.headers as Record<string, string>); return json(result()); });
    try {
      const env = { OPC_META_DATA_URL: "http://m", OPC_DB_CONNECT_URL: "http://d", OPC_BFF_URL: "http://b/", OPC_APP: "app", OPC_DEV_ACTOR: "u_librarian", OPC_DEV_ROLES: "LIBRARIAN" } as unknown as NodeJS.ProcessEnv;
      await callService("bff", "POST", "api/v1/capabilities/A.B/execute", { config: opcConfig(env), body: {}, idempotencyKey: "k1" });
      await callService("bff", "POST", "api/v1/capabilities/A.B/execute", { config: opcConfig({ ...env, OPC_DEV_IDENTITY: "1" }), body: {} });
      await callService("bff", "POST", "api/v1/capabilities/A.B/execute", { config: opcConfig({ ...env, OPC_DEV_IDENTITY: "1" }), body: {}, identity: null });
    } finally { vi.unstubAllGlobals(); }
    expect(seen[0]).toEqual({ "content-type": "application/json", "idempotency-key": "k1" });
    expect(seen[1]).toMatchObject({ "x-opc-actor": "u_librarian", "x-opc-roles": "LIBRARIAN" });
    expect(seen[2]["x-opc-actor"]).toBeUndefined();
  });
});
