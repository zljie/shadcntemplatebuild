import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateReact } from "./generator";
import { listTemplates, getTemplate } from "./templates";
import { versions } from "./schema";

/**
 * Publishes the runtime and every saved template as a shadcn-compatible registry
 * (https://ui.shadcn.com/docs/registry/registry-item-json), so any project — or any AI that
 * knows the shadcn CLI / MCP — can install them with:
 *
 *   npx shadcn@latest add <baseUrl>/r/shadcnplane-runtime.json
 *   npx shadcn@latest add <baseUrl>/r/template-books.json
 *
 * Served dynamically by src/app/r/[name]/route.ts and written statically by scripts/build-registry.mts.
 */
export const RUNTIME_ITEM = "shadcnplane-runtime";
const runtimeFiles = [
  "components.tsx",
  "presentation.ts",
  "tokens.ts",
  "data.ts",
  "records.ts",
  "styles.css",
  "theme.css",
];
// Official shadcn items the runtime imports from @/components/ui/*.
const uiDependencies = ["button", "input", "card", "dialog", "badge", "tabs"];

type RegistryFile = {
  path: string;
  type: string;
  target: string;
  content: string;
};
export type RegistryItem = {
  $schema: string;
  name: string;
  type: string;
  title: string;
  description: string;
  dependencies?: string[];
  registryDependencies?: string[];
  files: RegistryFile[];
  meta?: Record<string, unknown>;
};

/** Rewrites project-internal aliases to the conventional aliases of a shadcn project. */
export function toConsumerImports(source: string): string {
  return source
    .replaceAll(
      '"@/runtime/components"',
      '"@/components/shadcnplane/components"',
    )
    .replaceAll('"@/runtime/', '"@/components/shadcnplane/')
    .replaceAll('"@/core/utils"', '"@/lib/utils"');
}

export async function runtimeItem(root = process.cwd()): Promise<RegistryItem> {
  const pkg = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  const files = await Promise.all(
    runtimeFiles.map(async (name) => ({
      path: `registry/shadcnplane/${name}`,
      type: "registry:file",
      target: `@components/shadcnplane/${name}`,
      content: toConsumerImports(
        await readFile(path.join(root, "src/runtime", name), "utf8"),
      ),
    })),
  );
  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: RUNTIME_ITEM,
    type: "registry:block",
    title: "Shadcnplane Runtime",
    description:
      "DSL 渲染运行时：Contextual Shell、列表／详情、搜索筛选、业务表单与 Badge/Tabs/Card 等适配块。模板页面依赖它。",
    dependencies: ["lucide-react", "radix-ui", "class-variance-authority"].map(
      (name) =>
        pkg.dependencies[name] ? `${name}@${pkg.dependencies[name]}` : name,
    ),
    registryDependencies: uiDependencies,
    files,
    meta: {
      versions,
      note: "UI primitives resolve to the official shadcn items; exact upstream revision of the local snapshot is unverified (see THIRD_PARTY).",
    },
  };
}

export async function templateItem(
  id: string,
  baseUrl: string,
): Promise<RegistryItem | null> {
  const template = await getTemplate(id);
  if (!template) return null;
  const page = toConsumerImports(
    await generateReact(template.document),
  ).replace(
    '"use client";\n',
    '"use client";\nimport "@/components/shadcnplane/styles.css";\n',
  );
  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: `template-${template.id}`,
    type: "registry:page",
    title: template.name,
    description:
      template.description || `由 Shadcnplane 模板 ${template.id} 生成的页面`,
    registryDependencies: [
      `${baseUrl.replace(/\/$/, "")}/r/${RUNTIME_ITEM}.json`,
    ],
    files: [
      {
        path: `registry/templates/${template.id}/page.tsx`,
        type: "registry:page",
        target: `app/${template.id}/page.tsx`,
        content: page,
      },
    ],
    meta: {
      templateId: template.id,
      tags: template.tags,
      updatedAt: template.updatedAt,
      dsl: template.document,
    },
  };
}

export async function registryIndex(baseUrl: string) {
  const templates = await listTemplates();
  return {
    $schema: "https://ui.shadcn.com/schema/registry.json",
    name: "shadcnplane",
    homepage: baseUrl,
    items: [
      {
        name: RUNTIME_ITEM,
        type: "registry:block",
        title: "Shadcnplane Runtime",
        description: "模板页面共用的 DSL 运行时",
        url: `${baseUrl}/r/${RUNTIME_ITEM}.json`,
      },
      ...templates.map((t) => ({
        name: `template-${t.id}`,
        type: "registry:page",
        title: t.name,
        description: t.description,
        url: `${baseUrl}/r/template-${t.id}.json`,
      })),
    ],
  };
}

/** Resolve `/r/<name>.json`. */
export async function registryEntry(
  name: string,
  baseUrl: string,
): Promise<unknown | null> {
  const bare = name.replace(/\.json$/, "");
  if (bare === "registry" || bare === "index") return registryIndex(baseUrl);
  if (bare === RUNTIME_ITEM) return runtimeItem();
  if (bare.startsWith("template-"))
    return templateItem(bare.slice("template-".length), baseUrl);
  return null;
}
