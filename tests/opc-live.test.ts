import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpcClient } from "../src/export-app/runtime/opc-client";
import * as route from "../src/export-app/runtime/opc-route";
import { manifest } from "../src/export-app/runtime/modules";
import { BffRepository } from "../src/export-app/runtime/repository";
import { newIdempotencyKey } from "../src/runtime/opc";

/**
 * Against the live local opc-platform (S1 BookCopy list, S2 borrow). Skipped unless the BFF answers at
 * OPC_BFF_URL (default http://127.0.0.1:4000) with an active release. The exported app's own pieces are
 * exercised end to end: opc-client → app proxy route (server-side identity) → BFF.
 * Borrowing writes; when the opc-platform checkout is found (OPC_PLATFORM_DIR, default ../opcadminmonorepo/opc-platform)
 * the library sample data is reloaded first so the reader's loan limit (2) is not exhausted by earlier runs.
 */
const bff = (process.env.OPC_BFF_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
const platformDir = path.resolve(process.env.OPC_PLATFORM_DIR ?? "../opcadminmonorepo/opc-platform");
const live = await fetch(`${bff}/health`, { signal: AbortSignal.timeout(1500) }).then(r => r.json()).then((h: { release?: string | null }) => !!h.release).catch(() => false);

const saved = { ...process.env };
// The exported route reads its configuration from the server environment, exactly as in a generated app.
const routeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input), "http://app.local"), request = new Request(url, init);
  const context = { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/opc\//, "").split("/") }) };
  return request.method === "GET" ? route.GET(request, context) : route.POST(request, context);
}) as typeof fetch;
const client = createOpcClient("/api/opc", routeFetch);

describe.skipIf(!live)("live opc-platform BFF", () => {
  beforeAll(() => {
    Object.assign(process.env, { DATA_MODE: "bff", OPC_BFF_URL: bff, OPC_DEV_IDENTITY: "1", OPC_DEV_ACTOR: "u_librarian", OPC_DEV_ROLES: "LIBRARIAN" });
    if (existsSync(path.join(platformDir, "executors/library/src/seed.ts")))
      execFileSync(process.execPath, ["--import", path.join(platformDir, "node_modules/tsx/dist/loader.mjs"), "executors/library/src/seed.ts"],
        { cwd: platformDir, env: { ...process.env, DATABASE_URL: process.env.OPC_DATABASE_URL ?? "postgres://opc:opc@127.0.0.1:5432/opc" }, stdio: "pipe" });
  });
  afterAll(() => { process.env = saved; });

  it("S1: lists book copies through the read-only GraphQL capability and the BFF repository", async () => {
    const answer = await client.query("BookCopy.List", { status: "AVAILABLE", limit: 10 });
    expect(answer.status).toBe("SUCCEEDED");
    expect(Array.isArray(answer.data)).toBe(true);
    manifest.modules.splice(0, manifest.modules.length, {
      key: "book-copy", title: "馆藏副本", entity: "book_copy", objectType: "campus-library-book-copy", links: {}, seed: [], actions: [],
      config: {
        entityName: "馆藏副本", titleField: "barcode", columns: [{ field: "barcode", title: "条码" }], searchFields: ["barcode"], filters: [], detailFields: ["status"], rows: [],
        fields: [{ key: "copy_id", label: "副本", type: "text" }, { key: "barcode", label: "条码", type: "text" }, { key: "status", label: "状态", type: "text" }, { key: "book", label: "书名", type: "text" }],
        dataSource: { type: "capability", capabilityRef: "BookCopy.List", input: { limit: 50 }, idField: "copy_id", fieldPaths: { book: "title.title" } },
      },
    });
    const rows = await new BffRepository(client, { list: async () => [], submit: async () => ({ ok: false, errors: [], message: "" }), remove: async () => false }).list("book-copy");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.find(r => r.id === "c_sicp_1")).toMatchObject({ barcode: "B0001", book: "计算机程序的构造和解释" });
  });

  it("S1: a command is refused on the read-only GraphQL path", async () => {
    expect(await client.query("Library.Borrow", { readerId: "u_reader", copyId: "c_sicp_1" })).toMatchObject({ status: "REJECTED", reasons: [{ code: "CAPABILITY_NOT_A_QUERY" }] });
  });

  it("S2: borrow = preview → confirm (execute with Idempotency-Key) → receipt; retries return the same receipt", async () => {
    const copies = (await client.query("BookCopy.List", { status: "AVAILABLE", limit: 50 })).data as { copy_id: string }[];
    const copyId = copies.find(c => c.copy_id.startsWith("c_sicp"))?.copy_id;
    expect(copyId, "an AVAILABLE c_sicp copy (reload the opc-platform sample data)").toBeTruthy();
    const input = { readerId: "u_reader", copyId: copyId! };

    const preview = await client.execute("Library.Borrow", input, { phase: "PREVIEW" });
    expect(preview).toMatchObject({ phase: "PREVIEW", status: "SUCCEEDED", data: { loanId: null, preview: true } });

    const key = newIdempotencyKey();
    const receipt = await client.execute("Library.Borrow", input, { phase: "EXECUTE", idempotencyKey: key });
    expect(receipt).toMatchObject({ phase: "EXECUTE", status: "SUCCEEDED", requestId: key, data: { preview: false } });
    expect(String((receipt.data as { loanId: string }).loanId)).not.toBe("null");

    const again = await client.execute("Library.Borrow", input, { phase: "EXECUTE", idempotencyKey: key });
    expect(again.data).toEqual(receipt.data);
    expect((await client.execution(key))?.status).toBe("SUCCEEDED");

    const after = await client.execute("Library.Borrow", input, { phase: "PREVIEW" });
    expect(after.status).toBe("REJECTED");
    expect(after.reasons[0].code).toBe("COPY_NOT_AVAILABLE");
  });

  it("S2: rule rejections carry reasons; command EXECUTE without a key is refused", async () => {
    const rejected = await client.execute("Library.Borrow", { readerId: "u_suspended", copyId: "c_sicp_3" }, { phase: "PREVIEW" });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reasons.length).toBeGreaterThan(0);
    await expect(client.execute("Library.Borrow", { readerId: "u_reader", copyId: "c_sicp_3" })).rejects.toThrow(/Idempotency-Key/);
  });
});
