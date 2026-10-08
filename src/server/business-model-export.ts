import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateReact, stableStringify } from "../core/generator";
import { projectBase, sortFiles } from "../core/export-project";
import { validateDocument } from "../core/validation";
import type { PageDocument } from "../core/schema";
import type { AppManifest, AppModule } from "../export-app/runtime/types";
import { getBusinessModel } from "./business-model-store";
import { getObjectType, hydratedListDetailDocument, runtimeConfig } from "./ontology-store";

/**
 * Exports the app generated from a business model as one standalone Next.js frontend project:
 * per module /<key> (list + detail, generated from its Page DSL), /<key>/<id>, /<key>/new and
 * /<key>/<id>/edit, shared navigation, links between modules, seed data behind a replaceable
 * Repository, the model's queries/commands as contract.json, and traceability in app-design.json.
 */
export type AppExport = {files: Record<string, string>; modules: {key: string; entity: string; objectType: string; routes: string[]}[]; skipped: {entity: string; reason: string}[]};
type Result = {ok: true; value: AppExport} | {ok: false; status: number; message: string};

const runtimeTemplates = ["types.ts", "repository.ts", "app.tsx", "record-pages.tsx"];
const moduleKey = (entity: string) => entity.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const identifier = (key: string) => `seed_${key.replace(/-/g, "_")}`;
const routePage = (component: string, module: string, params: "id" | null, extra = "") => `"use client";
${params ? `import { use } from "react";\n` : ""}import { ${component} } from "@/app-runtime/record-pages";

export default function Page(${params ? "{ params }: { params: Promise<{ id: string }> }" : ""}) {
${params ? "  const { id } = use(params);\n" : ""}  return <${component} module=${JSON.stringify(module)}${params ? " id={decodeURIComponent(id)}" : ""}${extra} />;
}
`;

export async function exportApp(id: string): Promise<Result> {
  const stored = getBusinessModel(id);
  if (!stored) return {ok: false, status: 404, message: "业务模型不存在"};
  const model = stored.model, design = model.appDesign;
  const entities = [...new Set([...(design?.modules.map(m => m.entity) ?? []), ...Object.keys(model.bindings)])].filter(e => model.bindings[e]);
  if (!entities.length) return {ok: false, status: 409, message: "还没有应用设计：先在「应用设计」中生成应用，或为业务对象创建页面"};

  const skipped: AppExport["skipped"] = [], picked: {entity: string; key: string; apiName: string; document: PageDocument}[] = [];
  for (const entity of entities) {
    const apiName = model.bindings[entity].objectType, document = getObjectType(apiName) ? hydratedListDetailDocument(apiName) : null;
    if (!document?.listDetail) { skipped.push({entity, reason: `数据模型 ${apiName} 或其列表页面不存在`}); continue; }
    picked.push({entity, key: moduleKey(entity), apiName, document});
  }
  if (!picked.length) return {ok: false, status: 409, message: "没有可导出的模块"};
  const keyByType = new Map(picked.map(p => [p.apiName, p.key]));
  const plan = new Map((design?.plan.modules ?? []).map(m => [m.entity, m]));
  const exportedAt = new Date().toISOString();
  const appName = design?.plan.appName ?? `${model.name} 应用`;

  const files = await projectBase(moduleKey(model.name) || "business-app");
  const root = process.cwd();
  for (const name of runtimeTemplates) files[`src/app-runtime/${name}`] = await readFile(path.join(root, "src/export-app/runtime", name), "utf8");
  files["src/runtime/record-pages.css"] = await readFile(path.join(root, "src/runtime/record-pages.css"), "utf8");
  files["src/app/globals.css"] += '@import "../runtime/record-pages.css";\n';

  const modules: AppModule[] = [], summary: AppExport["modules"] = [];
  for (const {entity, key, apiName, document} of picked) {
    const type = getObjectType(apiName)!, {rows, ...config} = runtimeConfig(apiName)!;
    const links = Object.fromEntries(type.properties.flatMap(p => p.baseType === "link" && p.target && keyByType.has(p.target) ? [[p.apiName, keyByType.get(p.target)!]] : []));
    const actions = model.actions.filter(a => a.entity === entity || a.appliesTo === entity).map(a => ({
      id: a.id, name: a.name, kind: a.kind, operation: a.operation, roles: a.roles,
      rules: model.rules.filter(r => r.scope.actionIds.includes(a.id)).map(r => r.id), input: a.inputSchema, output: a.outputSchema,
    }));
    modules.push({key, title: type.pluralDisplayName ?? type.displayName, entity, objectType: apiName, config: {...config, rows: []}, links, seed: [], actions});
    files[`src/app-data/${key}.json`] = JSON.stringify(rows, null, 2) + "\n";

    const page: PageDocument = {...document, listDetail: {...document.listDetail!, rows: []}};
    const issues = validateDocument(page);
    if (issues.length) return {ok: false, status: 422, message: `${key} 页面 DSL 无效：${issues.map(i => `${i.path} ${i.message}`).join("；")}`};
    files[`dsl/${key}.dsl.json`] = stableStringify(document) + "\n";
    files[`src/app/${key}/page.tsx`] = await generateReact(page, {app: {module: key}});
    files[`src/app/${key}/[id]/page.tsx`] = routePage("RecordDetailPage", key, "id");
    files[`src/app/${key}/new/page.tsx`] = routePage("RecordFormPage", key, null);
    files[`src/app/${key}/[id]/edit/page.tsx`] = routePage("RecordFormPage", key, "id");
    summary.push({key, entity, objectType: apiName, routes: [`/${key}`, `/${key}/[id]`, `/${key}/new`, `/${key}/[id]/edit`]});
  }

  const manifest: AppManifest = {appName, workspaceName: picked[0].document.shell.workspaceName, model: {name: model.name, sourceVersion: model.sourceVersion, exportedAt}, modules};
  files["src/app-runtime/modules.ts"] = `import type { DataRecord } from "@/runtime/data";
import type { AppManifest } from "./types";
${modules.map(m => `import ${identifier(m.key)} from "../app-data/${m.key}.json";`).join("\n")}

/** Generated from business model ${model.name} (${model.sourceVersion || "no version"}) at ${exportedAt}. */
const base: AppManifest = ${stableStringify(manifest)};
const seeds: Record<string, DataRecord[]> = {${modules.map(m => `${JSON.stringify(m.key)}: ${identifier(m.key)} as DataRecord[]`).join(", ")}};
export const manifest: AppManifest = {...base, modules: base.modules.map(m => ({...m, seed: seeds[m.key] ?? []}))};
`;
  files["src/app/page.tsx"] = `import { redirect } from "next/navigation";\n\nexport default function Home() {\n  redirect(${JSON.stringify(`/${modules[0].key}`)});\n}\n`;
  files["contract.json"] = JSON.stringify({model: manifest.model, note: "Queries and commands of the business model per module. Implement src/app-runtime/repository.ts against a backend that honours these contracts.",
    modules: modules.map(m => ({key: m.key, entity: m.entity, actions: m.actions}))}, null, 2) + "\n";
  files["app-design.json"] = JSON.stringify({
    model: {...manifest.model, file: stored.fileName}, appName, designSource: design?.source ?? "manual", designGeneratedAt: design?.generatedAt,
    modules: summary.map(m => ({...m, displayName: plan.get(m.entity)?.displayName, scenarios: plan.get(m.entity)?.scenarios ?? [], pageDsl: `dsl/${m.key}.dsl.json`, seed: `src/app-data/${m.key}.json`})),
    scenarios: (model.scenarios ?? []).map(s => ({id: s.id, name: s.name, status: s.status, actions: s.steps.map(step => step.action)})),
    skipped,
  }, null, 2) + "\n";
  files["README.md"] = `# ${appName}

Generated by Composer from business model \`${model.name}\` (source version ${model.sourceVersion || "n/a"}) at ${exportedAt}. Node 24 required.

\`\`\`sh
npm install
npm run build
npm start
\`\`\`

Open http://127.0.0.1:3101.

## Structure

| Path | Purpose |
|---|---|
| \`src/app/<module>/page.tsx\` | List + detail page, generated from \`dsl/<module>.dsl.json\` (the page source of truth) |
| \`src/app/<module>/[id]\`, \`new\`, \`[id]/edit\` | Record detail and create / edit pages |
| \`src/app-runtime/repository.ts\` | Data access. Default: seed data in \`src/app-data\` plus browser storage. Replace with a client for your backend and keep the \`Repository\` interface |
| \`contract.json\` | Queries and commands of the business model per module (input/output JSON Schema, roles, rules) |
| \`app-design.json\` | Traceability: model version → module → business object → routes, page DSL and scenarios |

Modules: ${summary.map(m => `\`/${m.key}\``).join(", ")}.

Records are prototype data. Authorization, business rules and transactions declared in the model are not enforced by this frontend; they belong to the backend that implements contract.json.
`;
  return {ok: true, value: {files: sortFiles(files), modules: summary, skipped}};
}
