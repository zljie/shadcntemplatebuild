import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { componentCapabilities, pageProtocol } from "../core/page-protocol";
import { validateDocument } from "../core/validation";
import { exportProject } from "../core/export-project";
import {
  applyCommands,
  componentSource,
  componentSummaries,
} from "../core/agent-ops";
import {
  getTemplate,
  listTemplates,
  saveTemplate,
  templateIdPattern,
  withoutDocument,
} from "../core/templates";
import { RUNTIME_ITEM } from "../core/shadcn-registry";
import type { PageDocument } from "../core/schema";

/**
 * One tool surface for every transport (STDIO in src/mcp/server.mts, Streamable HTTP in
 * src/app/api/mcp/route.ts). `local` enables tools that write to the server's filesystem
 * outside the template library (export_project), which only make sense next to the caller.
 */
export type PageServerOptions = { local: boolean; registryBaseUrl?: string };

const result = (value: Record<string, unknown>, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value,
  isError,
});
const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};
const documentInput = z.object({ document: z.unknown() }).strict();

export function createPageServer({
  local,
  registryBaseUrl,
}: PageServerOptions): McpServer {
  const server = new McpServer({ name: "shadcnplane-pages", version: "0.2.0" });
  const registryHint = registryBaseUrl
    ? {
        runtimeItem: `${registryBaseUrl}/r/${RUNTIME_ITEM}.json`,
        install: `npx shadcn@latest add ${registryBaseUrl}/r/${RUNTIME_ITEM}.json`,
      }
    : {
        runtimeItem: `<host>/r/${RUNTIME_ITEM}.json`,
        note: "Run the builder (npm run dev) and use its origin as <host>.",
      };

  // ── Discovery ─────────────────────────────────────────────────────────────
  server.registerTool(
    "list_components",
    {
      description:
        "List the registered DSL components (the ONLY components a page may use). detail='summary' (default) returns name, description, props keys, slots and allowed parents; detail='full' adds JSON Schemas and source metadata. Use get_component for one component in full.",
      inputSchema: z
        .object({ detail: z.enum(["summary", "full"]).optional() })
        .strict(),
      annotations: readOnly,
    },
    async ({ detail }) =>
      result({
        components:
          detail === "full" ? componentCapabilities() : componentSummaries(),
      }),
  );

  server.registerTool(
    "get_component",
    {
      description:
        "Full definition of one componentRef: props JSON Schema, defaults, slots, parents, actions, source files and dependencies.",
      inputSchema: z.object({ componentRef: z.string().max(80) }).strict(),
      annotations: readOnly,
    },
    async ({ componentRef }) => {
      const found = componentCapabilities().find(
        (c) => c.componentRef === componentRef,
      );
      return found
        ? result({ component: found })
        : result(
            {
              error: `Unknown componentRef ${componentRef}`,
              available: componentSummaries().map((c) => c.componentRef),
            },
            true,
          );
    },
  );

  server.registerTool(
    "get_page_protocol",
    {
      description:
        "Read the page DSL JSON Schema, composition rules and starter templates before generating a page from scratch. Prefer list_templates/get_template to start from a human-designed template.",
      inputSchema: z.object({}).strict(),
      annotations: readOnly,
    },
    async () => result(pageProtocol()),
  );

  // ── Templates (shared with the drag-and-drop builder) ──────────────────────
  server.registerTool(
    "list_templates",
    {
      description:
        "List page templates designed in the drag-and-drop builder (id, name, description, tags). Start from one of these with get_template instead of writing DSL from scratch.",
      inputSchema: z.object({ tag: z.string().max(20).optional() }).strict(),
      annotations: readOnly,
    },
    async ({ tag }) =>
      result({
        templates: (await listTemplates()).filter(
          (t) => !tag || t.tags.includes(tag),
        ),
      }),
  );

  server.registerTool(
    "get_template",
    {
      description:
        "Get one template's full page DSL document. Modify it with apply_commands (preferred) or edit the JSON, then validate_page.",
      inputSchema: z
        .object({ id: z.string().regex(templateIdPattern) })
        .strict(),
      annotations: readOnly,
    },
    async ({ id }) => {
      const template = await getTemplate(id);
      return template
        ? result({ template })
        : result({ error: `Template ${id} not found` }, true);
    },
  );

  server.registerTool(
    "save_template",
    {
      description:
        "Validate and save a page DSL into the shared template library (templates/<id>.json) so humans can open it in the builder. Overwrites a template with the same id.",
      inputSchema: z
        .object({
          id: z.string().regex(templateIdPattern),
          name: z.string().min(1).max(80),
          description: z.string().max(500).optional(),
          tags: z.array(z.string().min(1).max(20)).max(10).optional(),
          document: z.unknown(),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const saved = await saveTemplate({ ...input, source: "mcp" });
        if (!saved.ok)
          return result({ saved: false, errors: saved.errors }, true);
        return result({
          saved: true,
          template: withoutDocument(saved.template),
        });
      } catch (error) {
        return result(
          {
            saved: false,
            errors: [
              {
                path: "templates",
                message:
                  error instanceof Error
                    ? error.message
                    : "write failed (read-only deployment?)",
              },
            ],
          },
          true,
        );
      }
    },
  );

  // ── Editing & validation ───────────────────────────────────────────────────
  server.registerTool(
    "validate_page",
    {
      description:
        "Validate a page DSL against the project validator (components, props, slots, parents, Shell, business fields). Returns valid and path/message errors.",
      inputSchema: documentInput,
      annotations: readOnly,
    },
    async ({ document }) => {
      const errors = validateDocument(document);
      return result({ valid: errors.length === 0, errors }, errors.length > 0);
    },
  );

  server.registerTool(
    "apply_commands",
    {
      description:
        "Incrementally edit a page DSL with editor commands, applied atomically and validated. Commands: node.insert {node,target:{parentId,slot,index}}, node.move {nodeId,target}, node.remove {nodeId}, node.update {nodeId,value:{props?,layout?,tokens?,responsive?,slots?}}, page.rename {name}. New nodes need the full node shape (id, componentRef, componentVersion '0.1.0', props, layout, tokens, responsive, slots, actions, meta.locked=false); use get_component for defaults. Returns the new document or errors (document unchanged).",
      inputSchema: z
        .object({
          document: z.unknown(),
          commands: z.array(z.unknown()).min(1).max(100),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ document, commands }) => {
      const applied = applyCommands(document, commands);
      return applied.ok
        ? result({ ok: true, document: applied.document })
        : result({ ok: false, errors: applied.errors }, true);
    },
  );

  // ── Code delivery ──────────────────────────────────────────────────────────
  server.registerTool(
    "generate_page_code",
    {
      description:
        "Generate code for a valid page DSL and return it INLINE (no files written). scope='page' returns only page.tsx plus how to install the shared runtime via the shadcn registry (best for adding a page to an existing shadcn project); scope='project' returns every file of a standalone Next.js project.",
      inputSchema: z
        .object({
          document: z.unknown(),
          scope: z.enum(["page", "project"]).optional(),
        })
        .strict(),
      annotations: readOnly,
    },
    async ({ document, scope }) => {
      const errors = validateDocument(document);
      if (errors.length) return result({ valid: false, errors }, true);
      const files = await exportProject(document as PageDocument);
      if (scope === "project") return result({ valid: true, files });
      return result({
        valid: true,
        files: { "page.tsx": files["src/app/page.tsx"] },
        imports:
          "@/runtime/components (rewrite to wherever the runtime is installed)",
        registry: registryHint,
      });
    },
  );

  server.registerTool(
    "get_component_source",
    {
      description:
        "Return the source files (inline) and npm dependencies behind one componentRef, including the shadcn UI primitives it uses.",
      inputSchema: z.object({ componentRef: z.string().max(80) }).strict(),
      annotations: readOnly,
    },
    async ({ componentRef }) => {
      const source = await componentSource(componentRef);
      return source
        ? result({ ...source, registry: registryHint })
        : result({ error: `Unknown componentRef ${componentRef}` }, true);
    },
  );

  if (local) {
    server.registerTool(
      "export_project",
      {
        description:
          "Validate DSL and write an independent runnable Next.js project to a NEW temporary directory on this machine. Returns projectDir and files; never overwrites. Only available over STDIO.",
        inputSchema: documentInput,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async ({ document }) => {
        const errors = validateDocument(document);
        if (errors.length) return result({ valid: false, errors }, true);
        const files = await exportProject(document as PageDocument);
        const projectDir = await mkdtemp(
          path.join(tmpdir(), "shadcnplane-page-"),
        );
        for (const [name, content] of Object.entries(files)) {
          const destination = path.join(projectDir, name);
          await mkdir(path.dirname(destination), { recursive: true });
          await writeFile(destination, content, { flag: "wx" });
        }
        return result({ valid: true, projectDir, files: Object.keys(files) });
      },
    );
  }

  // ── Resources & prompts ────────────────────────────────────────────────────
  server.registerResource(
    "page-protocol",
    "shadcnplane://protocol",
    {
      title: "Page DSL protocol",
      mimeType: "application/json",
      description: "Schema, rules and starter templates",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(pageProtocol()),
        },
      ],
    }),
  );
  server.registerResource(
    "components",
    "shadcnplane://components",
    {
      title: "Component catalogue",
      mimeType: "application/json",
      description: "Summary of registered components",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(componentSummaries()),
        },
      ],
    }),
  );

  server.registerPrompt(
    "design_page",
    {
      title: "Design a page from a template",
      description:
        "Guided workflow: pick a template, adapt it with apply_commands, validate, then deliver code.",
      argsSchema: z.object({
        request: z.string().describe("What page to build, in natural language"),
      }),
    },
    ({ request }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Build this page with the shadcnplane-pages tools: ${request}\n\n1. list_templates and pick the closest one (get_template). If none fits, read get_page_protocol and start from its template.\n2. Change it with apply_commands (or edit listDetail for business fields/rows), keeping only registered components (list_components).\n3. validate_page and fix every path/message error.\n4. Deliver: generate_page_code (scope 'page' for an existing shadcn project, 'project' for a standalone app) and optionally save_template so humans can refine it in the builder.`,
          },
        },
      ],
    }),
  );

  return server;
}
