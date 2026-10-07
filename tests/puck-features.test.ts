import { describe, expect, it } from "vitest";
import { createDocument } from "../src/core/document";
import { execute, type Command, type Result } from "../src/core/commands";
import { makeNode, registry } from "../src/core/registry";
import { validateDocument, locate } from "../src/core/validation";
import { migrateDocument, type Migrations } from "../src/core/migrations";
import { resolvePermissions } from "../src/core/permissions";
import { applyCommands, componentSummaries } from "../src/core/agent-ops";
import { runPageAgent, buildSystemPrompt } from "../src/ai/page-agent";
import { MockProvider } from "../src/llm/providers/mock";
import { pageProtocol } from "../src/core/page-protocol";
import { generateReact } from "../src/core/generator";
import type { PageDocument } from "../src/core/schema";

function run(document: PageDocument, command: Command, revision = 0): Result {
  return execute(document, revision, {
    id: "test",
    timestamp: "2026-10-07T00:00:00Z",
    actor: { type: "human", id: "test" },
    pageId: document.id,
    baseRevision: revision,
    command,
  });
}
function ok(result: Result) {
  if (!result.success) throw new Error(JSON.stringify(result.errors));
  return result;
}
function failed(result: Result) {
  expect(result.success).toBe(false);
  return result.success ? [] : result.errors;
}
function protect(
  document: PageDocument,
  nodeId: string,
  permissions: Record<string, boolean>,
) {
  return ok(run(document, { type: "node.permissions", nodeId, permissions }))
    .document;
}

describe("data migrations", () => {
  const steps: Migrations = {
    document: [
      {
        from: "0.0.9",
        to: "0.1.0",
        migrate: (doc) => ({ ...doc, name: `${doc.name}（已升级）` }),
      },
    ],
    component: [
      {
        componentRef: "pattern.page-header",
        from: "0.0.9",
        to: "0.1.0",
        transformProps: ({ heading, ...rest }) => ({ ...rest, title: heading }),
      },
    ],
  };
  it("upgrades document and component versions without mutating input", () => {
    const legacy = JSON.parse(JSON.stringify(createDocument())) as {
      schemaVersion: string;
      dependencies: { pageSchema: string };
      root: {
        slots: { children: { componentVersion: string; props: object }[] };
      }[];
    };
    legacy.schemaVersion = "0.0.9";
    legacy.dependencies.pageSchema = "0.0.9";
    const header = legacy.root[0].slots.children[0];
    header.componentVersion = "0.0.9";
    header.props = { heading: "旧标题", description: "说明" };
    const snapshot = JSON.stringify(legacy);
    const { document, applied } = migrateDocument(legacy, steps);
    expect(JSON.stringify(legacy)).toBe(snapshot);
    expect(applied).toEqual([
      "document 0.0.9 → 0.1.0",
      "pattern.page-header 0.0.9 → 0.1.0",
    ]);
    expect(validateDocument(document)).toEqual([]);
    const upgraded = document as PageDocument;
    expect(upgraded.name).toBe("资源管理（已升级）");
    expect(upgraded.root[0].slots.children[0].props).toEqual({
      description: "说明",
      title: "旧标题",
    });
  });
  it("returns current documents untouched", () => {
    const doc = createDocument();
    const result = migrateDocument(doc);
    expect(result.applied).toEqual([]);
    expect(result.document).toBe(doc);
  });
});

describe("permissions", () => {
  it("resolves global, component and node layers; Shell regions stay locked", () => {
    const doc = createDocument();
    expect(resolvePermissions(doc.root[0])).toEqual({
      delete: false,
      move: false,
      duplicate: false,
      edit: true,
    });
    const header = doc.root[0].slots.children[0];
    expect(resolvePermissions(header)).toEqual({
      delete: true,
      move: true,
      duplicate: true,
      edit: true,
    });
    const protectedDoc = protect(doc, "page-header", {
      delete: false,
      edit: false,
    });
    expect(locate(protectedDoc, "page-header")!.node.meta.permissions).toEqual({
      delete: false,
      edit: false,
    });
    expect(
      failed(
        run(doc, {
          type: "node.permissions",
          nodeId: "workspace",
          permissions: { edit: false },
        }),
      ).length,
    ).toBe(1);
  });
  it("blocks delete, edit and move, including a parent removal, and undo restores permissions", () => {
    let doc = createDocument();
    doc = ok(
      run(doc, {
        type: "node.insert",
        node: makeNode("layout.stack", "stack"),
        target: { parentId: "workspace", slot: "children", index: 3 },
      }),
    ).document;
    doc = ok(
      run(doc, {
        type: "node.move",
        nodeId: "search-bar",
        target: { parentId: "stack", slot: "children", index: 0 },
      }),
    ).document;
    const result = ok(
      run(doc, {
        type: "node.permissions",
        nodeId: "search-bar",
        permissions: { delete: false, move: false, edit: false },
      }),
    );
    const locked = result.document;
    expect(
      failed(run(locked, { type: "node.remove", nodeId: "search-bar" }))[0]
        .message,
    ).toContain("禁止删除");
    expect(
      failed(run(locked, { type: "node.remove", nodeId: "stack" }))[0].message,
    ).toContain("禁止删除");
    expect(
      failed(
        run(locked, {
          type: "node.update",
          nodeId: "search-bar",
          value: { props: { placeholder: "x" } },
        }),
      )[0].message,
    ).toContain("禁止编辑属性");
    expect(
      failed(
        run(locked, {
          type: "node.move",
          nodeId: "search-bar",
          target: { parentId: "workspace", slot: "children", index: 0 },
        }),
      ).length,
    ).toBeGreaterThan(0);
    const restored = ok(run(locked, result.inverseCommand, 1)).document;
    expect(restored).toEqual(doc);
  });
  it("lets an AI rebuild a region while protected nodes come back unchanged", () => {
    const doc = protect(createDocument(), "page-header", {
      delete: false,
      edit: false,
    });
    const header = locate(doc, "page-header")!.node;
    const rebuilt: Command[] = [
      ...doc.root[0].slots.children
        .map((n) => ({ type: "node.remove", nodeId: n.id }) as Command)
        .reverse(),
      {
        type: "node.insert",
        node: header,
        target: { parentId: "workspace", slot: "children", index: 0 },
      },
    ];
    expect(applyCommands(doc, rebuilt).ok).toBe(true);
    const edited = structuredClone(header);
    edited.props.title = "AI 改了标题";
    const errors = applyCommands(doc, [
      ...rebuilt.slice(0, -1),
      {
        type: "node.insert",
        node: edited,
        target: { parentId: "workspace", slot: "children", index: 0 },
      },
    ]);
    expect(errors.ok).toBe(false);
  });
  it("keeps permission changes a human decision under AI and MCP", () => {
    const doc = createDocument();
    const result = applyCommands(doc, [
      {
        type: "node.permissions",
        nodeId: "page-header",
        permissions: { delete: false },
      },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toContain("只能由人");
  });
});

describe("AI generation hints", () => {
  it("hides ai.exclude components and rejects AI edits to excludeFields", () => {
    const button = registry["shadcn.button"];
    const original = button.ai;
    button.ai = { ...original, exclude: true };
    try {
      expect(
        componentSummaries().some((c) => c.componentRef === "shadcn.button"),
      ).toBe(false);
      const result = applyCommands(createDocument(), [
        {
          type: "node.insert",
          node: makeNode("shadcn.button", "cta"),
          target: { parentId: "workspace", slot: "children", index: 0 },
        },
      ]);
      expect(result.ok).toBe(false);
      button.ai = { ...original, excludeFields: ["message"] };
      const node = makeNode("shadcn.button", "cta");
      expect(
        applyCommands(createDocument(), [
          {
            type: "node.insert",
            node,
            target: { parentId: "workspace", slot: "children", index: 0 },
          },
        ]).ok,
      ).toBe(true);
      const changed = {
        ...node,
        props: { ...node.props, message: "已提交订单" },
      };
      const denied = applyCommands(createDocument(), [
        {
          type: "node.insert",
          node: changed,
          target: { parentId: "workspace", slot: "children", index: 0 },
        },
      ]);
      expect(denied.ok).toBe(false);
    } finally {
      button.ai = original;
    }
  });
  it("adds business context to the system prompt without changing the cached rules", async () => {
    let system = "";
    const provider = new MockProvider((request) => {
      system = request.messages.find((m) => m.role === "system")!.content;
      return JSON.stringify({ mode: "none", reply: "好的" });
    });
    await runPageAgent({
      provider,
      document: createDocument(),
      context: "我们是连锁药店进销存 SaaS，语气专业简洁。",
      messages: [{ role: "user", content: "做个库存页" }],
    });
    expect(system.startsWith(buildSystemPrompt())).toBe(true);
    expect(system).toContain("## 业务背景");
    expect(system).toContain("连锁药店");
    await runPageAgent({
      provider,
      document: createDocument(),
      messages: [{ role: "user", content: "做个库存页" }],
    });
    expect(system).toBe(buildSystemPrompt());
  });
});

describe("page shells", () => {
  it("switches to the focus shell and back, keeping workspace content, with an exact undo", () => {
    const doc = createDocument();
    const focus = ok(run(doc, { type: "page.shell", variant: "focus" }));
    expect(focus.document.root.map((n) => n.id)).toEqual(["workspace"]);
    expect(focus.document.root[0].slots.children.map((n) => n.id)).toEqual([
      "page-header",
      "search-bar",
      "resource-table",
    ]);
    expect(validateDocument(focus.document)).toEqual([]);
    expect(ok(run(focus.document, focus.inverseCommand, 1)).document).toEqual(
      doc,
    );
    const back = ok(
      run(focus.document, { type: "page.shell", variant: "contextual" }, 1),
    ).document;
    expect(back.root.map((n) => n.id)).toEqual(["workspace", "context"]);
    expect(back.root[1].slots.children.map((n) => n.componentRef)).toEqual([
      "composite.resource-details",
    ]);
  });
  it("rejects business list/detail config on a shell without a details panel", () => {
    const errors = failed(
      run(pageProtocol().formTemplate, {
        type: "page.shell",
        variant: "focus",
      }),
    );
    expect(errors.some((e) => e.path === "listDetail")).toBe(true);
  });
  it("creates, validates and exports focus pages without opening a missing details panel", async () => {
    const doc = createDocument(false, "focus");
    expect(validateDocument(doc)).toEqual([]);
    doc.root[0].slots.children.push(makeNode("composite.data-table", "table"));
    expect(validateDocument(doc)).toEqual([]);
    expect(await generateReact(doc)).toContain("openDetails={false}");
    expect(
      validateDocument({
        ...doc,
        root: [...doc.root, makeNode("composite.context-panel", "context")],
      }).some((e) => e.path === "root"),
    ).toBe(true);
  });
  it("describes shells to the AI", () => {
    expect(pageProtocol().shells.map((s) => s.variant)).toEqual([
      "contextual",
      "focus",
    ]);
    expect(buildSystemPrompt()).toContain('"variant":"focus"');
  });
});

describe("dynamic fields", () => {
  it("shows the third tab label only once the second is used", () => {
    const tabs = registry["shadcn.tabs"];
    expect(
      tabs.resolveFields!({ label1: "a", label2: "", label3: "" }).map(
        (f) => f.key,
      ),
    ).toEqual(["label1", "label2"]);
    expect(
      tabs.resolveFields!({ label1: "a", label2: "b", label3: "" }).map(
        (f) => f.key,
      ),
    ).toEqual(["label1", "label2", "label3"]);
  });
});
