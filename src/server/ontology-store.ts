import { readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getDatabase, transaction } from "./db";
import { templatesDir } from "../core/templates";
import { validateDocument } from "../core/validation";
import type { PageDocument } from "../core/schema";
import { resourceListDetail, type DataRecord, type ListDetail } from "../runtime/data";
import { applyRecordRequest, type RecordResult } from "../runtime/records";
import {
  fromListDetail, generateListDetailDocument, normalizeRow, pageId, pageKinds, toListDetail, validateObjectType,
  type Issue, type LinkOptions, type ObjectType, type ObjectTypeInput, type PageKind,
} from "../ontology/model";

/**
 * Persistent ontology + object store + page catalog on SQLite. Objects are stored as JSON per
 * type (no DDL per object type), so a model can change while a prototype is being explored;
 * reads coerce stored data to the current definition.
 */
export type PageRecord = {id: string; objectType: string; kind: PageKind; name: string; source: string; updatedAt: string; hasDocument: boolean};
export type ObjectTypeSummary = {type: ObjectType; count: number; pages: PageRecord[]; updatedAt: string; sampleId?: string};
type Result<T> = {ok: true; value: T} | {ok: false; errors: Issue[]};

const now = () => new Date().toISOString();
const parse = <T>(text: string): T => JSON.parse(text) as T;

export function db(): DatabaseSync {
  const database = getDatabase();
  seedOnce(database);
  return database;
}

// ── Object types ────────────────────────────────────────────────────────────
export function listObjectTypes(): ObjectType[] {
  return (db().prepare("select definition from object_types order by position, api_name").all() as {definition: string}[]).map(r => parse<ObjectType>(r.definition));
}
export function getObjectType(apiName: string): ObjectType | null {
  const row = db().prepare("select definition from object_types where api_name = ?").get(apiName) as {definition: string} | undefined;
  return row ? parse<ObjectType>(row.definition) : null;
}
export function catalog(): ObjectTypeSummary[] {
  const database = db();
  const counts = new Map((database.prepare("select type, count(*) as n from objects group by type").all() as {type: string; n: number}[]).map(r => [r.type, Number(r.n)]));
  const pages = listPages();
  const samples = new Map((database.prepare("select type, min(id) as id from objects group by type").all() as {type: string; id: string}[]).map(r => [r.type, r.id]));
  return (database.prepare("select definition, updated_at from object_types order by position, api_name").all() as {definition: string; updated_at: string}[]).map(r => {
    const type = parse<ObjectType>(r.definition);
    return {type, count: counts.get(type.apiName) ?? 0, pages: pages.filter(p => p.objectType === type.apiName), updatedAt: r.updated_at, sampleId: samples.get(type.apiName)};
  });
}

export function saveObjectType(input: ObjectTypeInput | unknown, database = db()): Result<ObjectType> {
  const apiName = (input as {apiName?: unknown})?.apiName;
  const known = listObjectTypes().map(t => t.apiName).concat(typeof apiName === "string" ? [apiName] : []);
  const checked = validateObjectType(input, known);
  if (!checked.ok) return {ok: false, errors: checked.errors};
  const type = checked.type, time = now();
  const position = Number((database.prepare("select coalesce(max(position), -1) + 1 as p from object_types").get() as {p: number}).p);
  database.prepare(`insert into object_types(api_name, definition, position, created_at, updated_at) values (?, ?, ?, ?, ?)
    on conflict(api_name) do update set definition = excluded.definition, updated_at = excluded.updated_at`).run(type.apiName, JSON.stringify(type), position, time, time);
  // Keep stored primary keys in sync with a changed primaryKey property.
  for (const row of database.prepare("select id, data from objects where type = ?").all(type.apiName) as {id: string; data: string}[]) {
    const pk = String(parse<Record<string, unknown>>(row.data)[type.primaryKey] ?? row.id);
    try { database.prepare("update objects set pk = ? where type = ? and id = ?").run(pk, type.apiName, row.id); }
    catch { database.prepare("update objects set pk = ? where type = ? and id = ?").run(`${pk}#${row.id}`, type.apiName, row.id); }
  }
  return {ok: true, value: type};
}

export function deleteObjectType(apiName: string): Result<true> {
  const referencing = listObjectTypes().filter(t => t.apiName !== apiName && t.properties.some(p => p.target === apiName));
  if (referencing.length) return {ok: false, errors: [{path: "apiName", message: `仍被 ${referencing.map(t => t.displayName).join("、")} 关联，请先删除关联属性`}]};
  const changes = Number(db().prepare("delete from object_types where api_name = ?").run(apiName).changes);
  return changes ? {ok: true, value: true} : {ok: false, errors: [{path: "apiName", message: "类型不存在"}]};
}

// ── Objects ─────────────────────────────────────────────────────────────────
function titleOf(type: ObjectType, data: Record<string, unknown>, id: string): string {
  const title = data[type.titleProperty];
  return typeof title === "string" && title ? title : id;
}
export function linkOptions(type: ObjectType): LinkOptions {
  const targets = [...new Set(type.properties.flatMap(p => p.baseType === "link" && p.target ? [p.target] : []))];
  return Object.fromEntries(targets.map(target => {
    const targetType = getObjectType(target);
    if (!targetType) return [target, []];
    const rows = db().prepare("select id, data from objects where type = ? order by created_at, id").all(target) as {id: string; data: string}[];
    return [target, rows.map(r => ({label: titleOf(targetType, parse(r.data), r.id).slice(0, 40), value: r.id}))];
  }));
}
/** Runtime list/detail/form configuration with live rows and link options. */
export function runtimeConfig(apiName: string): ListDetail | null {
  const type = getObjectType(apiName);
  if (!type) return null;
  const config = toListDetail(type, [], linkOptions(type));
  const rows = (db().prepare("select id, data from objects where type = ? order by created_at, id").all(apiName) as {id: string; data: string}[])
    .map(r => normalizeRow(config, r.id, parse(r.data)));
  return {...config, rows};
}
export function getObject(apiName: string, id: string): {type: ObjectType; config: ListDetail; record: DataRecord} | null {
  const config = runtimeConfig(apiName), type = getObjectType(apiName);
  const record = config?.rows.find(r => r.id === id);
  return type && config && record ? {type, config, record} : null;
}
/** Objects of other types whose link properties point at this object. */
export function incomingLinks(apiName: string, id: string): {type: ObjectType; property: string; records: {id: string; title: string}[]}[] {
  return listObjectTypes().flatMap(type => type.properties.filter(p => p.baseType === "link" && p.target === apiName).map(p => ({
    type, property: p.displayName,
    records: (db().prepare("select id, data from objects where type = ? and json_extract(data, ?) = ? order by created_at, id limit 50").all(type.apiName, `$.${p.apiName}`, id) as {id: string; data: string}[])
      .map(r => ({id: r.id, title: titleOf(type, parse(r.data), r.id)})),
  }))).filter(group => group.records.length);
}

/** Create/update with the same validation as the in-browser simulation, persisted and idempotent by operationId. */
export function runRecordAction(apiName: string, request: unknown): RecordResult {
  const database = db();
  const type = getObjectType(apiName), config = runtimeConfig(apiName);
  if (!type || !config) return {ok: false, errors: [{path: "type", message: "对象类型不存在"}], message: "对象类型不存在"};
  const operationId = (request as {operationId?: unknown})?.operationId;
  if (typeof operationId !== "string" || !operationId || operationId.length > 80) return {ok: false, errors: [{path: "operationId", message: "操作 ID 必须为非空字符串，最多 80 字符"}], message: "提交失败"};
  const signature = JSON.stringify(request);
  return transaction(database, () => {
    const previous = database.prepare("select signature, result from operations where id = ?").get(operationId) as {signature: string; result: string} | undefined;
    if (previous) return previous.signature === signature ? parse<RecordResult>(previous.result) : {ok: false, errors: [{path: "operationId", message: "同一操作 ID 不能更换输入"}], message: "提交失败"};
    const result = applyRecordRequest(config, config.rows, request, {maxRows: 100_000});
    if (result.ok) {
      const {id, ...data} = result.record, time = now();
      database.prepare(`insert into objects(type, id, pk, data, created_at, updated_at) values (?, ?, ?, ?, ?, ?)
        on conflict(type, id) do update set pk = excluded.pk, data = excluded.data, updated_at = excluded.updated_at`).run(apiName, id, String(data[type.primaryKey]), JSON.stringify(data), time, time);
    }
    database.prepare("insert into operations(id, signature, result, created_at) values (?, ?, ?, ?)").run(operationId, signature, JSON.stringify(result), now());
    return result;
  });
}
export function deleteObject(apiName: string, id: string): boolean {
  return Number(db().prepare("delete from objects where type = ? and id = ?").run(apiName, id).changes) > 0;
}
/** Bulk import used by seeding and MCP; rows are validated through runRecordAction semantics. */
export function importObjects(apiName: string, rows: DataRecord[], database = db()): void {
  const type = getObjectType(apiName);
  if (!type) throw new Error(`对象类型不存在：${apiName}`);
  const config = toListDetail(type, [], linkOptions(type)), time = now();
  const insert = database.prepare("insert or ignore into objects(type, id, pk, data, created_at, updated_at) values (?, ?, ?, ?, ?, ?)");
  rows.forEach((row, i) => {
    const {id, ...data} = normalizeRow(config, row.id, row);
    insert.run(apiName, id, String(data[type.primaryKey]), JSON.stringify(data), new Date(Date.parse(time) + i).toISOString(), time);
  });
}

// ── Pages ───────────────────────────────────────────────────────────────────
type PageRow = {id: string; object_type: string; kind: PageKind; name: string; source: string; updated_at: string; document: string | null};
const toPage = (r: PageRow): PageRecord => ({id: r.id, objectType: r.object_type, kind: r.kind, name: r.name, source: r.source, updatedAt: r.updated_at, hasDocument: !!r.document});
export function listPages(): PageRecord[] {
  return (db().prepare("select p.* from pages p join object_types t on t.api_name = p.object_type order by t.position, p.object_type, p.kind").all() as PageRow[]).map(toPage);
}
export function getPage(id: string): (PageRecord & {document: PageDocument | null}) | null {
  const row = db().prepare("select * from pages where id = ?").get(id) as PageRow | undefined;
  return row ? {...toPage(row), document: row.document ? parse<PageDocument>(row.document) : null} : null;
}
/** Generates (or regenerates) the page set for a type. Composer edits to list-detail are kept unless overwrite. */
export function generatePages(apiName: string, kinds: readonly PageKind[] = pageKinds, {overwrite = false, source = "ontology"} = {}): Result<PageRecord[]> {
  const type = getObjectType(apiName);
  if (!type) return {ok: false, errors: [{path: "objectType", message: "对象类型不存在"}]};
  const database = db(), time = now(), plural = type.pluralDisplayName ?? type.displayName;
  for (const kind of kinds) {
    const id = pageId(apiName, kind), existing = getPage(id);
    if (existing && !overwrite) continue;
    let document: string | null = null;
    if (kind === "list-detail") {
      const config = runtimeConfig(apiName)!;
      const doc = generateListDetailDocument(type, config.rows, linkOptions(type));
      const issues = validateDocument(doc);
      if (issues.length) return {ok: false, errors: issues};
      document = JSON.stringify(doc);
    }
    const name = kind === "list-detail" ? `${plural}管理` : kind === "detail" ? `${type.displayName}详情` : `新建${type.displayName}`;
    database.prepare(`insert into pages(id, object_type, kind, name, document, source, updated_at) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set name = excluded.name, document = excluded.document, source = excluded.source, updated_at = excluded.updated_at`).run(id, apiName, kind, name, document, source, time);
  }
  return {ok: true, value: listPages().filter(p => p.objectType === apiName)};
}
export function savePageDocument(id: string, document: unknown): Result<PageRecord> {
  const page = getPage(id);
  if (!page) return {ok: false, errors: [{path: "id", message: "页面不存在"}]};
  if (page.kind !== "list-detail") return {ok: false, errors: [{path: "kind", message: "只有列表 + 详情页面使用 Page DSL"}]};
  const issues = validateDocument(document);
  if (issues.length) return {ok: false, errors: issues};
  db().prepare("update pages set document = ?, name = ?, source = 'composer', updated_at = ? where id = ?").run(JSON.stringify(document), (document as PageDocument).name, now(), id);
  return {ok: true, value: toPage(db().prepare("select * from pages where id = ?").get(id) as PageRow)};
}
export function deletePage(id: string): boolean {
  return Number(db().prepare("delete from pages where id = ?").run(id).changes) > 0;
}

/**
 * The list-detail page to render: the stored (possibly composer-edited) DSL, with the dataset
 * re-hydrated from SQLite. Presentation choices survive only for fields that still exist.
 */
export function hydratedListDetailDocument(apiName: string): PageDocument | null {
  const type = getObjectType(apiName), config = runtimeConfig(apiName);
  if (!type || !config) return null;
  const stored = getPage(pageId(apiName, "list-detail"))?.document ?? generateListDetailDocument(type, [], linkOptions(type));
  const saved = stored.listDetail, keys = new Set(config.fields.map(f => f.key));
  const keep = (values: string[] | undefined, fallback: string[]) => { const kept = (values ?? []).filter(k => keys.has(k)); return kept.length || values?.length === 0 ? kept : fallback; };
  const columns = (saved?.columns ?? []).filter(c => keys.has(c.field));
  const listDetail: ListDetail = {
    ...config,
    entityName: saved?.entityName ?? config.entityName,
    columns: columns.some(c => c.field === config.titleField) ? columns : config.columns,
    searchFields: keep(saved?.searchFields, config.searchFields),
    filters: keep(saved?.filters, config.filters),
    detailFields: keep(saved?.detailFields, config.detailFields),
  };
  if (!listDetail.searchFields.length) listDetail.searchFields = config.searchFields;
  if (!listDetail.detailFields.length) listDetail.detailFields = config.detailFields;
  return {...stored, listDetail};
}

/** Turns a list/detail page template into an object type with its example rows. */
export function importTemplateAsType(templateDocument: PageDocument, apiName: string, description = ""): Result<ObjectType> {
  if (!templateDocument.listDetail) return {ok: false, errors: [{path: "document.listDetail", message: "模板没有列表／详情数据配置"}]};
  if (getObjectType(apiName)) return {ok: false, errors: [{path: "apiName", message: `类型 ${apiName} 已存在`}]};
  let type: ObjectType;
  try { type = fromListDetail(apiName, templateDocument.listDetail, description); }
  catch (error) { return {ok: false, errors: [{path: "apiName", message: error instanceof Error ? error.message : "无法转换模板"}]}; }
  const database = db();
  const saved = transaction(database, () => { const result = saveObjectType(type, database); if (result.ok) importObjects(apiName, templateDocument.listDetail!.rows, database); return result; });
  if (saved.ok) generatePages(apiName);
  return saved;
}

// ── Seed ────────────────────────────────────────────────────────────────────
const seeds = [
  {template: "resource-center", apiName: "resource", plural: "资源", icon: "sparkles", description: "工作空间中的技能、MCP 连接器与文档。"},
  {template: "books", apiName: "book", plural: "图书", icon: "book", description: "馆藏图书、分类、库存与借阅状态。"},
  {template: "users", apiName: "user", plural: "用户", icon: "user", description: "系统用户、账号、角色与启用状态。"},
] as const;
const loanType: ObjectTypeInput = {
  apiName: "loan", displayName: "借阅记录", pluralDisplayName: "借阅记录", icon: "calendar", description: "连接图书与用户的借阅事件，演示本体中的关联（Link）。",
  primaryKey: "code", titleProperty: "code",
  properties: [
    {apiName: "code", displayName: "借阅编号", baseType: "string", required: true, maxLength: 20},
    {apiName: "book", displayName: "图书", baseType: "link", target: "book", required: true},
    {apiName: "borrower", displayName: "借阅人", baseType: "link", target: "user", required: true},
    {apiName: "borrowedAt", displayName: "借出日期", baseType: "date", required: true, default: "2026-10-01"},
    {apiName: "dueAt", displayName: "应还日期", baseType: "date"},
    {apiName: "status", displayName: "状态", baseType: "enum", required: true, options: ["借阅中", "已归还", "已逾期"]},
    {apiName: "note", displayName: "备注", baseType: "longText"},
  ],
};
const loanRows: DataRecord[] = [
  {id: "loan-01", code: "L-2026-001", book: "book-02", borrower: "user-03", borrowedAt: "2026-09-20", dueAt: "2026-10-20", status: "借阅中", note: ""},
  {id: "loan-02", code: "L-2026-002", book: "book-01", borrower: "user-02", borrowedAt: "2026-09-01", dueAt: "2026-09-30", status: "已逾期", note: "已电话提醒"},
  {id: "loan-03", code: "L-2026-003", book: "book-02", borrower: "user-01", borrowedAt: "2026-08-10", dueAt: "2026-09-10", status: "已归还", note: ""},
];

function seedOnce(database: DatabaseSync): void {
  if (database.prepare("select 1 from meta where key = 'seeded'").get()) return;
  if (process.env.DATABASE_SEED === "off") { database.prepare("insert into meta(key, value) values ('seeded', ?)").run(now()); return; }
  transaction(database, () => {
    database.prepare("insert into meta(key, value) values ('seeded', ?)").run(now());
    for (const seed of seeds) {
      let config: ListDetail | undefined;
      try { config = parse<{document: PageDocument}>(readFileSync(path.join(templatesDir(), `${seed.template}.json`), "utf8")).document.listDetail; } catch { /* template removed */ }
      if (seed.apiName === "resource") config ??= resourceListDetail;
      if (!config) continue;
      const type = {...fromListDetail(seed.apiName, config, seed.description), pluralDisplayName: seed.plural, icon: seed.icon};
      if (!saveObjectType(type, database).ok) continue;
      importObjects(seed.apiName, config.rows, database);
    }
    if (getObjectType("book") && getObjectType("user") && saveObjectType(loanType, database).ok) importObjects("loan", loanRows, database);
  });
  for (const type of listObjectTypes()) generatePages(type.apiName, pageKinds, {source: "seed"});
}

