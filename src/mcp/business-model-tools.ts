import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { completeness, enumValues, inferEvents, inferRoles, inferStates, type View } from "../business-model/model";
import { validateScenario } from "../business-model/sandbox";
import { upgradeDocument } from "../core/migrations";
import { validateDocument } from "../core/validation";
import { pageId } from "../ontology/model";
import { getBusinessModel, importBusinessModel, listBusinessModels, summarize, updateBusinessModel, type StoredBusinessModel } from "../server/business-model-store";
import { runAppDesign, runSandbox } from "../server/business-model-ai";
import { exportApp } from "../server/business-model-export";
import { getPage, savePageDocument } from "../server/ontology-store";

/**
 * Business-model tools: the full frontend flow over MCP — ontology YAML → business model →
 * sandbox scenarios → app design (object types + pages) → page refinement → exported Next.js app.
 */
const result = (value: Record<string, unknown>, isError = false) => ({content: [{type: "text" as const, text: JSON.stringify(value)}], structuredContent: value, isError});
const failure = (message: string, extra: Record<string, unknown> = {}) => result({error: message, ...extra}, true);
const readOnly = {readOnlyHint: true, destructiveHint: false, openWorldHint: false};
const writes = {readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false};
const modelId = z.string().min(1).max(80).describe("Business model id from import_business_model or list_business_models");

const omitRaw = <T extends {raw: unknown}>(element: T): Omit<T, "raw"> => { const copy: Partial<T> = {...element}; delete copy.raw; return copy as Omit<T, "raw">; };
const views = ["overview", "entities", "relationships", "actions", "rules", "roles", "states", "events", "metrics", "issues", "scenarios", "app_design"] as const;

/** One view of the model, without the raw YAML payload (kept server-side for round-trip export). */
function viewOf(stored: StoredBusinessModel, view: typeof views[number]): Record<string, unknown> {
  const {model, issues} = stored;
  const state = (v: View, id: string) => completeness(model, v, id, issues);
  switch (view) {
    case "overview": return {...summarize(stored), metadata: model.metadata, bindings: model.bindings};
    case "entities": return {entities: model.entities.map(e => ({
      id: e.id, displayName: e.displayName ?? e.synonyms[0], description: e.description, source: e.source, primaryKey: e.primaryKey, uniqueKeys: e.uniqueKeys, completeness: state("entity", e.id),
      fields: e.fields.map(f => ({id: f.id, displayName: f.displayName, type: f.type, description: f.description, isTime: f.isTime, constraints: f.constraints, enum: enumValues(f)})),
    }))};
    case "relationships": return {relationships: model.relationships.map(omitRaw)};
    case "actions": return {actions: model.actions.map(a => ({...omitRaw(a), completeness: state("action", a.id)}))};
    case "rules": return {rules: model.rules.map(r => ({...omitRaw(r), completeness: state("rule", r.id)}))};
    case "roles": return {roles: inferRoles(model)};
    case "states": return {states: inferStates(model)};
    case "events": return {events: inferEvents(model)};
    case "metrics": return {metrics: model.metrics.map(omitRaw)};
    case "issues": return {issues};
    case "scenarios": return {scenarios: (model.scenarios ?? []).map(s => ({...s, issues: validateScenario(model, s)}))};
    case "app_design": return {appDesign: model.appDesign ?? null, bindings: model.bindings};
  }
}

export function registerBusinessModelTools(server: McpServer, {local}: {local: boolean}): void {
  server.registerTool("import_business_model", {
    description: "Import an ontology YAML (semantic_model with datasets, relationships, metrics, behavior.actions/rules) as a business model. Reference problems are returned as issues with YAML paths; only unparsable input is rejected. Returns the model id used by the other business-model tools.",
    inputSchema: z.object({yaml: z.string().min(1).max(2_000_000), fileName: z.string().max(200).optional()}).strict(),
    annotations: writes,
  }, async ({yaml, fileName}) => {
    const imported = importBusinessModel(yaml, fileName ?? "model.yaml");
    if (!imported.ok) return failure("导入失败", {issues: imported.issues});
    return result({model: summarize(imported.value), issues: imported.value.issues.slice(0, 100)});
  });

  server.registerTool("list_business_models", {description: "List imported business models with counts per view and issue totals.", inputSchema: z.object({}).strict(), annotations: readOnly},
    async () => result({models: listBusinessModels()}));

  server.registerTool("get_business_model", {
    description: `Read one view of a business model (BMF-001): ${views.join(", ")}. Roles, states and events are inferred and marked as such; scenarios include reference checks; completeness is defined/validated/bound/verified.`,
    inputSchema: z.object({id: modelId, view: z.enum(views).default("overview")}).strict(),
    annotations: readOnly,
  }, async ({id, view}) => {
    const stored = getBusinessModel(id);
    return stored ? result({id, view, ...viewOf(stored, view)}) : failure("业务模型不存在");
  });

  server.registerTool("update_business_model", {
    description: "Apply edits atomically. Patch kinds: {kind:'entity',id,displayName?,description?}, {kind:'field',entity,id,displayName?,description?,constraints?:{required?,nullable?,unique?,enum?}}, {kind:'action'|'rule'|'metric',id,...text}, {kind:'scenario',id,status:'confirmed'|'inferred'}, {kind:'removeScenario',id}. Stable ids are never rewritten.",
    inputSchema: z.object({id: modelId, patches: z.array(z.record(z.string(), z.unknown())).min(1).max(100)}).strict(),
    annotations: writes,
  }, async ({id, patches}) => {
    const updated = updateBusinessModel(id, patches);
    return updated.ok ? result({model: summarize(updated.value), issues: updated.value.issues.slice(0, 100)}) : failure("修改失败", {issues: updated.issues});
  });

  server.registerTool("run_business_sandbox", {
    description: "业务沙盘推演: infer business scenarios (actors, ordered actions, reads/writes, state changes, events, rules, exceptions) from the model with the server's configured LLM (rule-based drafts without one). New scenarios are stored as inferred; confirm them with update_business_model {kind:'scenario',status:'confirmed'} to use them as process blueprints.",
    inputSchema: z.object({id: modelId, focus: z.string().max(200).optional(), count: z.number().int().min(1).max(10).optional()}).strict(),
    annotations: {...writes, openWorldHint: true},
  }, async ({id, focus, count}) => {
    const run = await runSandbox(id, {focus, count});
    if (!run.ok) return failure(run.message, {problems: run.problems ?? []});
    return result({source: run.source, problems: run.problems, scenarios: run.added.map(s => ({...s, issues: validateScenario(run.model.model, s)}))});
  });

  server.registerTool("generate_app_design", {
    description: "One-click conversion of the business model into app design: the configured LLM (or rules) plans modules, names, title/list fields, labels and sample values; the plan is validated and every module becomes an object type with sample records and list-detail, detail and form pages. Pages edited in the builder are not overwritten.",
    inputSchema: z.object({id: modelId}).strict(),
    annotations: {...writes, openWorldHint: true},
  }, async ({id}) => {
    const run = await runAppDesign(id);
    if (!run.ok) return failure(run.message, {problems: run.problems ?? []});
    const {plan, modules, issues, source} = run.design;
    return result({source, appName: plan.appName, summary: plan.summary, modules: modules.map(m => ({...m, listPageId: pageId(m.objectType, "list-detail")})), skipped: plan.skipped, issues});
  });

  server.registerTool("get_app_page", {
    description: "Get the list-detail Page DSL of a generated module (objectType from generate_app_design). Change it with apply_commands / validate_page, then save it back with save_app_page.",
    inputSchema: z.object({objectType: z.string().min(1).max(80)}).strict(),
    annotations: readOnly,
  }, async ({objectType}) => {
    const page = getPage(pageId(objectType, "list-detail"));
    return page?.document ? result({pageId: page.id, name: page.name, source: page.source, document: page.document}) : failure("页面不存在");
  });

  server.registerTool("save_app_page", {
    description: "Save a refined list-detail Page DSL for a generated module. The DSL is validated by the same rules as the builder; invalid documents are rejected with path/message errors.",
    inputSchema: z.object({objectType: z.string().min(1).max(80), document: z.unknown()}).strict(),
    annotations: writes,
  }, async ({objectType, document: input}) => {
    const document = upgradeDocument(input), errors = validateDocument(document);
    if (errors.length) return result({saved: false, errors}, true);
    const saved = savePageDocument(pageId(objectType, "list-detail"), document);
    return saved.ok ? result({saved: true, page: saved.value}) : result({saved: false, errors: saved.errors}, true);
  });

  server.registerTool("export_app", {
    description: local
      ? "Export the generated app as one standalone Next.js frontend project (all modules: list+detail, detail, new, edit routes; navigation; links; seed data behind a replaceable Repository; contract.json with the model's queries/commands; app-design.json traceability) into a NEW temporary directory. Returns projectDir and file list."
      : "Export the generated app as one standalone Next.js frontend project (all modules: list+detail, detail, new, edit routes; navigation; links; seed data behind a replaceable Repository; contract.json; app-design.json). Returns every file inline.",
    inputSchema: z.object({id: modelId}).strict(),
    annotations: local ? writes : readOnly,
  }, async ({id}) => {
    const exported = await exportApp(id);
    if (!exported.ok) return failure(exported.message);
    const {files, modules, skipped} = exported.value;
    if (!local) return result({modules, skipped, files});
    const projectDir = await mkdtemp(path.join(tmpdir(), "business-app-"));
    for (const [name, content] of Object.entries(files)) {
      const destination = path.join(projectDir, name);
      await mkdir(path.dirname(destination), {recursive: true});
      await writeFile(destination, content, {flag: "wx"});
    }
    return result({projectDir, modules, skipped, files: Object.keys(files), next: "cd projectDir && npm install && npm run build && npm start"});
  });

  server.registerPrompt("build_app_from_ontology", {
    title: "Build a frontend app from an ontology YAML",
    description: "Guided workflow: import the ontology, review it, run the business sandbox, generate the app design, refine pages and export the frontend project.",
    argsSchema: z.object({goal: z.string().describe("What the app is for, in natural language")}),
  }, ({goal}) => ({messages: [{role: "user" as const, content: {type: "text" as const, text:
    `Build a frontend app for: ${goal}\n\n1. import_business_model with the ontology YAML; read issues and fix definitions with update_business_model where the owner agrees (never rename ids).\n2. get_business_model (entities, actions, rules) to understand the domain.\n3. run_business_sandbox, review the scenarios and their issues, confirm the right ones as process blueprints.\n4. generate_app_design; check modules, skipped objects and issues.\n5. Optionally refine pages: get_app_page → apply_commands / validate_page → save_app_page.\n6. export_app and run npm install && npm run build in the project.`}}]}));
}
