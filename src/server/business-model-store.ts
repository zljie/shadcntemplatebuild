import {
  applyPatches, countModel, objectTypeName, parseBusinessModelYaml, toObjectType, validateBusinessModel,
  type BusinessModel, type ModelCounts, type ModelIssue,
} from "../business-model/model";
import { db, generatePages, getObjectType, saveObjectType, type PageRecord } from "./ontology-store";
import { transaction } from "./db";

/**
 * Business models persisted next to the ontology in SQLite. The typed model is stored as JSON and the
 * uploaded YAML is kept verbatim as the import source; issues are recomputed on every read.
 */
export type BusinessModelSummary = {id: string; name: string; fileName: string; description: string; sourceVersion: string; counts: ModelCounts; errors: number; warnings: number; createdAt: string; updatedAt: string};
export type StoredBusinessModel = BusinessModelSummary & {model: BusinessModel; issues: ModelIssue[]};
type Row = {id: string; name: string; file_name: string; document: string; source_yaml: string; created_at: string; updated_at: string};
type Result<T> = {ok: true; value: T} | {ok: false; issues: ModelIssue[]};

const now = () => new Date().toISOString();
const MAX_YAML = 2_000_000;

function toStored(row: Row): StoredBusinessModel {
  const model = JSON.parse(row.document) as BusinessModel, issues = validateBusinessModel(model);
  return {
    id: row.id, name: row.name, fileName: row.file_name, description: model.description, sourceVersion: model.sourceVersion, counts: countModel(model),
    errors: issues.filter(i => i.severity === "error").length, warnings: issues.filter(i => i.severity === "warning").length,
    createdAt: row.created_at, updatedAt: row.updated_at, model, issues,
  };
}
export const summarize = ({id, name, fileName, description, sourceVersion, counts, errors, warnings, createdAt, updatedAt}: StoredBusinessModel): BusinessModelSummary =>
  ({id, name, fileName, description, sourceVersion, counts, errors, warnings, createdAt, updatedAt});

export function listBusinessModels(): BusinessModelSummary[] {
  return (db().prepare("select * from business_models order by updated_at desc").all() as Row[]).map(r => summarize(toStored(r)));
}
export function getBusinessModel(id: string): StoredBusinessModel | null {
  const row = db().prepare("select * from business_models where id = ?").get(id) as Row | undefined;
  return row ? toStored(row) : null;
}

function uniqueId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "model";
  const taken = new Set((db().prepare("select id from business_models where id = ? or id like ?").all(base, `${base}-%`) as {id: string}[]).map(r => r.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Imports YAML as a new model. Reference problems are kept as issues; only unparsable input is rejected. */
export function importBusinessModel(yaml: string, fileName: string): Result<StoredBusinessModel> {
  if (yaml.length > MAX_YAML) return {ok: false, issues: [{severity: "error", path: "", message: "文件过大（上限 2 MB）"}]};
  const parsed = parseBusinessModelYaml(yaml);
  if (!parsed.ok) return {ok: false, issues: parsed.issues};
  const id = uniqueId(parsed.model.name), time = now();
  db().prepare("insert into business_models(id, name, file_name, document, source_yaml, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run(id, parsed.model.name, fileName.slice(0, 200) || "model.yaml", JSON.stringify(parsed.model), yaml, time, time);
  return {ok: true, value: getBusinessModel(id)!};
}

function save(id: string, model: BusinessModel): StoredBusinessModel {
  db().prepare("update business_models set document = ?, updated_at = ? where id = ?").run(JSON.stringify(model), now(), id);
  return getBusinessModel(id)!;
}

export function updateBusinessModel(id: string, patches: unknown[]): Result<StoredBusinessModel> {
  const stored = getBusinessModel(id);
  if (!stored) return {ok: false, issues: [{severity: "error", path: "id", message: "业务模型不存在"}]};
  const result = applyPatches(stored.model, patches);
  return result.ok ? {ok: true, value: save(id, result.model)} : result;
}

export function deleteBusinessModel(id: string): boolean {
  return Number(db().prepare("delete from business_models where id = ?").run(id).changes) > 0;
}

/**
 * Bridge to app design: projects one entity into an ontology object type and generates its pages
 * through the existing page path. Relationships to entities bound earlier become link properties.
 */
export function createPagesForEntity(id: string, entityId: string): Result<{objectType: string; pages: PageRecord[]; skipped: string[]; model: StoredBusinessModel}> {
  const stored = getBusinessModel(id);
  if (!stored) return {ok: false, issues: [{severity: "error", path: "id", message: "业务模型不存在"}]};
  const model = stored.model;
  const bound = Object.fromEntries(Object.entries(model.bindings).filter(([, b]) => getObjectType(b.objectType)).map(([entity, b]) => [entity, b.objectType]));
  const converted = toObjectType(model, entityId, bound);
  if (!converted.ok) return {ok: false, issues: [{severity: "error", path: "entity", message: converted.message}]};
  const apiName = objectTypeName(model, entityId), existing = getObjectType(apiName);
  if (existing && model.bindings[entityId]?.objectType !== apiName) return {ok: false, issues: [{severity: "error", path: "entity", message: `数据模型 ${apiName} 已存在且不属于该业务对象`}]};
  const database = db();
  const saved = transaction(database, () => saveObjectType(converted.type, database));
  if (!saved.ok) return {ok: false, issues: saved.errors.map(e => ({severity: "error", path: e.path, message: e.message}))};
  const pages = generatePages(apiName, undefined, {source: "business-model"});
  if (!pages.ok) return {ok: false, issues: pages.errors.map(e => ({severity: "error", path: e.path, message: e.message}))};
  const next: BusinessModel = {...model, bindings: {...model.bindings, [entityId]: {objectType: apiName, boundAt: now()}}};
  return {ok: true, value: {objectType: apiName, pages: pages.value, skipped: converted.skipped, model: save(id, next)}};
}
