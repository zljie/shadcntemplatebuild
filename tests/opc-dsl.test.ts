import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createDocument } from "../src/core/document";
import { generateReact } from "../src/core/generator";
import { migrateDocument, upgradeDocument } from "../src/core/migrations";
import { versions, type CommandAction, type PageDocument, type PageNode } from "../src/core/schema";
import { validateDocument, walk } from "../src/core/validation";
import { PageRenderer } from "../src/runtime/renderer";
import { resourceListDetail, type ListDetail } from "../src/runtime/data";
import { applyBindings, checkCapabilityRefs, suggestBindings } from "../src/platform/capability-binding";
import { diffReleases } from "../src/platform/release-diff";
import { formToInput, schemaFields } from "../src/platform/schema-form";
import type { Release } from "../src/server/opc-platform";

const release = async () => JSON.parse(await readFile("tests/fixtures/opc-release.json", "utf8")) as Release;
/** book_copy list/detail page as the business-model bridge generates it (fields = model fields). */
const bookCopy: ListDetail = {
  entityName: "馆藏副本", dataSource: "example", titleField: "barcode",
  fields: ["copy_id", "barcode", "title_id", "location", "status", "acquired_at"].map(key => ({ key, label: key, type: "text" as const })),
  columns: [{ field: "barcode", title: "条码" }, { field: "status", title: "状态" }], searchFields: ["barcode"], filters: ["status"], detailFields: ["copy_id", "status", "location"],
  rows: [{ id: "c_demo", copy_id: "c_demo", barcode: "B9", title_id: "t", location: "", status: "AVAILABLE", acquired_at: "" }],
};
const page = (listDetail: ListDetail = bookCopy): PageDocument => ({ ...createDocument(), name: "馆藏副本管理", listDetail });
const details = (doc: PageDocument): PageNode => { let found: PageNode | undefined; walk(doc.root, n => { if (n.componentRef === "composite.resource-details") found = n; }); return found!; };
const borrow: CommandAction = {
  event: "record.command", capabilityRef: "Library.Borrow", label: "办理借出", confirm: true,
  arguments: { copyId: { from: "row", field: "copy_id" }, readerId: { from: "form", label: "读者编号", type: "text", required: true } },
  result: { onSuccess: { refresh: true, notice: "借出成功", receipt: [{ key: "loanId", label: "借阅编号" }, { key: "dueAt", label: "应还时间" }] }, onRejected: { notice: "未能借出" } },
};

describe("Page DSL 0.2.0", () => {
  it("creates 0.2.0 documents and upgrades every 0.1.0 template and the committed 0.1.0 examples", async () => {
    expect(versions.pageSchema).toBe("0.2.0");
    expect(createDocument().schemaVersion).toBe("0.2.0");
    for (const file of await readdir("templates")) {
      const stored = JSON.parse(await readFile(`templates/${file}`, "utf8")) as { document: { schemaVersion: string } };
      expect(stored.document.schemaVersion).toBe("0.1.0"); // kept old on purpose: load paths migrate
      const { document, applied } = migrateDocument(stored.document);
      expect(applied).toEqual(["document 0.1.0 → 0.2.0"]);
      expect(validateDocument(document), file).toEqual([]);
      expect((document as PageDocument).dependencies).toMatchObject({ pageSchema: "0.2.0", codeGenerator: "0.2.0" });
    }
    for (const name of ["books", "users"]) {
      const legacy = JSON.parse(execFileSync("git", ["show", `main:examples/${name}.dsl.json`], { encoding: "utf8" }));
      expect(legacy.schemaVersion).toBe("0.1.0");
      expect(validateDocument(legacy).length).toBeGreaterThan(0);
      expect(validateDocument(upgradeDocument(legacy))).toEqual([]);
    }
  });

  it("keeps context.open and accepts record.command with arguments and result on the details panel", () => {
    const doc = page();
    details(doc).actions = [borrow];
    expect(validateDocument(doc)).toEqual([]);
    const table = doc.root[0].slots.children.find(n => n.componentRef === "composite.data-table")!;
    expect(table.actions).toEqual([{ event: "row.select", capabilityRef: "context.open" }]);
  });

  it("rejects commands in the wrong place, bad refs, unknown fields and duplicates", () => {
    const misplaced = page();
    misplaced.root[0].slots.children.find(n => n.componentRef === "composite.data-table")!.actions.push(borrow);
    expect(validateDocument(misplaced).map(i => i.message)).toContain("record.command 只能放在 composite.resource-details（详情面板）");
    const badRef = page(); details(badRef).actions = [{ ...borrow, capabilityRef: "borrow" }];
    expect(validateDocument(badRef)[0].message).toMatch(/Domain\.Name/);
    const badField = page(); details(badField).actions = [{ ...borrow, arguments: { copyId: { from: "row", field: "nope" } } }];
    expect(validateDocument(badField)).toEqual([{ path: expect.stringContaining("arguments.copyId"), message: "引用不存在的字段 nope" }]);
    const twice = page(); details(twice).actions = [borrow, borrow];
    expect(validateDocument(twice).map(i => i.message)).toContain("业务命令按钮「办理借出」重复");
    const noData = createDocument(); details(noData).actions = [borrow];
    expect(validateDocument(noData).map(i => i.message)).toContain("业务命令需要列表／详情数据配置（listDetail）");
  });

  it("accepts a capability data source next to example rows and checks its field paths", () => {
    const doc = page({ ...bookCopy, dataSource: { type: "capability", capabilityRef: "BookCopy.List", input: { limit: 20 }, idField: "copy_id", fieldPaths: { title_id: "title.title" } } });
    expect(validateDocument(doc)).toEqual([]);
    const bad = page({ ...bookCopy, dataSource: { type: "capability", capabilityRef: "BookCopy.List", input: {}, idField: "copy_id", fieldPaths: { ghost: "x" } } });
    expect(validateDocument(bad)).toEqual([{ path: "listDetail.dataSource.fieldPaths.ghost", message: "引用不存在的字段 ghost" }]);
    expect(validateDocument({ ...page(), listDetail: { ...bookCopy, dataSource: "graphql" } }).length).toBeGreaterThan(0);
  });

  it("generates and renders commands; without a capability client the button is disabled", async () => {
    const doc = page(); details(doc).actions = [borrow];
    const source = await generateReact(doc);
    expect(source).toMatch(/<ResourceDetails\s+commands=\{\[/);
    expect(source).toContain('capabilityRef: "Library.Borrow"');
    const legacy = await generateReact(page());
    expect(legacy).not.toContain("commands=");
    const html = renderToStaticMarkup(createElement(PageRenderer, { document: { ...doc, listDetail: { ...bookCopy } }, }));
    expect(html).not.toContain("办理借出"); // nothing selected yet: commands live in the details panel
    expect(validateDocument({ ...createDocument(), listDetail: resourceListDetail })).toEqual([]);
  });
});

describe("binding pages to a published release", () => {
  it("suggests the pass-through list and the entity's commands from the frozen operations", async () => {
    const suggestion = suggestBindings(await release(), "book_copy", bookCopy, "copy_id");
    expect(suggestion.dataSource).toEqual({ type: "capability", capabilityRef: "BookCopy.List", input: {}, idField: "copy_id" });
    expect(suggestion.notes.join()).toContain("acquired_at");
    const [first, second] = suggestion.commands;
    expect(first).toMatchObject({ capabilityRef: "Library.Borrow", label: "办理借出", confirm: true, arguments: { copyId: { from: "row", field: "copy_id" }, readerId: { from: "form", label: "readerId", type: "text", required: true } } });
    expect(second).toMatchObject({ capabilityRef: "BookCopy.UpdateLocation", confirm: false, arguments: { copy_id: { from: "row", field: "copy_id" }, location: { from: "form", field: "location" } } });
    expect(suggestBindings(await release(), "library_user", { ...bookCopy, fields: [{ key: "user_id", label: "u", type: "text" }] }, "user_id").dataSource).toBeNull();
  });

  it("writes the suggestion into valid DSL, checks it against the release and can unbind", async () => {
    const r = await release(), doc = page();
    const bound = applyBindings(doc, suggestBindings(r, "book_copy", bookCopy, "copy_id"));
    expect(validateDocument(bound)).toEqual([]);
    expect(checkCapabilityRefs(bound, r.capabilities)).toEqual([]);
    expect(details(bound).actions.map(a => a.capabilityRef)).toEqual(["Library.Borrow", "BookCopy.UpdateLocation"]);
    const wrong = applyBindings(doc, { dataSource: { type: "capability", capabilityRef: "Library.Borrow", input: { nope: 1 }, idField: "copy_id" }, commands: [{ ...borrow, arguments: { copyId: { from: "row", field: "copy_id" } } }] });
    expect(checkCapabilityRefs(wrong, r.capabilities).map(i => i.message)).toEqual(["能力 Library.Borrow 是 command，这里需要 query", "能力 Library.Borrow 的必填输入 readerId 没有绑定"]);
    const unbound = applyBindings(bound, { dataSource: null, commands: [] });
    expect(unbound.listDetail!.dataSource).toBe("example");
    expect(details(unbound).actions).toEqual([]);
  });

  it("diffs a release against the active one", async () => {
    const base = await release(), next = structuredClone(base);
    next.capabilities = next.capabilities.filter(c => c.capabilityRef !== "BookCopy.ListAvailable");
    next.operations[0] = { ...next.operations[0], documentSha256: `sha256:${"0".repeat(64)}` };
    next.packageRef = { ...next.packageRef, version: "0.2.0-poc.2" };
    const diff = diffReleases(base, next);
    expect(diff.same).toBe(false);
    expect(diff.package).toContain("0.2.0-poc.1 → campus_library@0.2.0-poc.2");
    expect(diff.sections.find(s => s.name === "capabilities")!.entries).toEqual([{ key: "BookCopy.ListAvailable", change: "removed" }]);
    expect(diff.sections.find(s => s.name === "operations")!.entries[0]).toMatchObject({ change: "changed", detail: expect.stringContaining("文档 hash") });
    expect(diffReleases(base, structuredClone(base)).same).toBe(true);
  });

  it("builds a try-run form from the capability input schema", async () => {
    const caps = (await release()).capabilities;
    const location = schemaFields(caps.find(c => c.capabilityRef === "BookCopy.UpdateLocation")!.inputSchema);
    expect(location).toEqual([{ key: "copy_id", kind: "string", required: true, nullable: false }, { key: "location", kind: "string", required: true, nullable: true }]);
    expect(formToInput(location, { copy_id: "c1", location: "" })).toEqual({ input: { copy_id: "c1", location: null }, errors: {} });
    const list = schemaFields(caps.find(c => c.capabilityRef === "BookCopy.List")!.inputSchema);
    expect(formToInput(list, { limit: "80", offset: "x" }).errors).toEqual({ limit: "不能大于 50", offset: "应为整数" });
    expect(formToInput(list, { limit: "5", status: "AVAILABLE" }).input).toEqual({ limit: 5, status: "AVAILABLE" });
  });
});
