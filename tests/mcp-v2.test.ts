import { it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDocument } from "../src/core/document";
import { makeNode } from "../src/core/registry";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sp-templates-"));
  process.env.TEMPLATES_DIR = dir;
});
afterAll(async () => {
  delete process.env.TEMPLATES_DIR;
  await rm(dir, { recursive: true, force: true });
});

async function httpClient() {
  const { POST } = await import("../src/app/api/mcp/route");
  const client = new Client({ name: "http-check", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("http://local.test/api/mcp"),
    {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        POST(new Request(input, init)),
    },
  );
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return {
      ...(r.structuredContent as Record<string, unknown>),
      isError: r.isError,
    } as Record<string, unknown>;
  };
  return { client, call };
}

it("serves the tool surface over Streamable HTTP without the local-only export tool", async () => {
  const { client, call } = await httpClient();
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("apply_commands");
    expect(names).not.toContain("export_project");
    const summary = (await call("list_components")).components as {
      componentRef: string;
      props: string[];
    }[];
    expect(
      summary.find((c) => c.componentRef === "shadcn.tabs")?.props,
    ).toEqual(["label1", "label2", "label3"]);
    expect(JSON.stringify(summary).length).toBeLessThan(
      JSON.stringify(
        (await call("list_components", { detail: "full" })).components,
      ).length,
    );
    expect(
      (await call("get_component", { componentRef: "shadcn.badge" })).component,
    ).toMatchObject({ componentRef: "shadcn.badge" });
    expect(
      (await call("get_component", { componentRef: "nope" })).isError,
    ).toBe(true);
  } finally {
    await client.close();
  }
});

it("edits with apply_commands, round-trips templates and returns code inline", async () => {
  const { client, call } = await httpClient();
  try {
    const document = createDocument();
    const badge = makeNode("shadcn.badge", "status-badge");
    const tabs = makeNode("shadcn.tabs", "info-tabs");
    const applied = await call("apply_commands", {
      document,
      commands: [
        {
          type: "node.insert",
          node: tabs,
          target: { parentId: "workspace", slot: "children", index: 1 },
        },
        {
          type: "node.insert",
          node: badge,
          target: { parentId: "info-tabs", slot: "tab-1", index: 0 },
        },
        { type: "page.rename", name: "带页签的资源页" },
      ],
    });
    expect(applied.ok).toBe(true);
    const edited = applied.document as typeof document;
    expect(edited.name).toBe("带页签的资源页");
    expect(edited.root[0].slots.children[1].slots["tab-1"][0].id).toBe(
      "status-badge",
    );

    const rejected = await call("apply_commands", {
      document,
      commands: [
        {
          type: "node.insert",
          node: makeNode("pattern.page-header", "h2"),
          target: { parentId: "context", slot: "children", index: 0 },
        },
      ],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.isError).toBe(true);

    expect(
      (
        await call("save_template", {
          id: "tabs-demo",
          name: "页签示例",
          tags: ["演示"],
          document: edited,
        })
      ).saved,
    ).toBe(true);
    expect(await readdir(dir)).toEqual(["tabs-demo.json"]);
    expect(
      (
        await call("save_template", {
          id: "bad",
          name: "x",
          document: { ...edited, root: [] },
        })
      ).saved,
    ).toBe(false);
    expect(
      ((await call("list_templates", { tag: "演示" })).templates as unknown[])
        .length,
    ).toBe(1);
    const template = (await call("get_template", { id: "tabs-demo" }))
      .template as { document: unknown };
    expect(template.document).toEqual(edited);

    const page = await call("generate_page_code", { document: edited });
    const code = (page.files as Record<string, string>)["page.tsx"];
    expect(code).toContain("<TabsBlock");
    expect(code).toMatch(/<TabsSlot name={"tab-1"}>\s*<BadgeBlock/);
    expect((page.registry as { runtimeItem: string }).runtimeItem).toBe(
      "http://local.test/r/shadcnplane-runtime.json",
    );
    const project = await call("generate_page_code", {
      document: edited,
      scope: "project",
    });
    expect(Object.keys(project.files as object)).toContain(
      "src/components/ui/tabs.tsx",
    );

    const source = await call("get_component_source", {
      componentRef: "shadcn.tabs",
    });
    expect((source.files as { path: string }[]).map((f) => f.path)).toEqual(
      expect.arrayContaining([
        "src/components/ui/tabs.tsx",
        "src/runtime/components.tsx",
      ]),
    );
  } finally {
    await client.close();
  }
});
