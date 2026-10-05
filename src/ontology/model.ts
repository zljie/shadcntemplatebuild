import { z } from "zod";
import { createDocument } from "../core/document";
import type { PageDocument } from "../core/schema";
import { validateBusinessConfig } from "../runtime/records";
import { recordActions, type DataRecord, type ListDetail, type RecordField, type RecordValue } from "../runtime/data";

/**
 * Ontology metamodel (object types, typed properties, links between types), modelled after
 * Palantir-style ontologies: every object type has a primary key and a title property, and a
 * `link` property points at another object type. Pages are projections of an object type, so one
 * model yields a full prototype: list+detail, standalone detail and create/edit form pages.
 * Pure module: safe for the browser, the server, MCP and tests.
 */
export const apiNamePattern = /^[a-z][a-z0-9-]{0,39}$/;
const propertyKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, "属性名只能包含字母、数字和下划线，并以字母开头")
  .refine(key => !["id", "__proto__", "constructor", "prototype"].includes(key), "保留属性名");
export const baseTypes = ["string", "longText", "integer", "decimal", "boolean", "date", "enum", "link"] as const;
export type BaseType = typeof baseTypes[number];
export const baseTypeLabels: Record<BaseType, string> = {string: "文本", longText: "长文本", integer: "整数", decimal: "小数", boolean: "布尔", date: "日期", enum: "枚举", link: "关联"};
export const objectIcons = ["box", "book", "user", "file", "plug", "sparkles", "package", "calendar", "building", "tag"] as const;

export const propertySchema = z.object({
  apiName: propertyKey,
  displayName: z.string().trim().min(1).max(40),
  baseType: z.enum(baseTypes),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  options: z.array(z.string().trim().min(1).max(40)).min(1).max(30).optional(),
  target: z.string().regex(apiNamePattern).optional(),
  min: z.number().finite().min(-1e9).max(1e9).optional(),
  max: z.number().finite().min(-1e9).max(1e9).optional(),
  maxLength: z.number().int().min(1).max(1000).optional(),
  default: z.union([z.string().max(1000), z.number().finite(), z.boolean()]).optional(),
  showInList: z.boolean().optional(),
  filterable: z.boolean().optional(),
  trueLabel: z.string().max(40).optional(),
  falseLabel: z.string().max(40).optional(),
}).strict();
export type Property = z.infer<typeof propertySchema>;

export const objectTypeSchema = z.object({
  apiName: z.string().regex(apiNamePattern, "类型 ID 只能包含小写字母、数字和连字符，并以字母开头"),
  displayName: z.string().trim().min(1).max(20),
  pluralDisplayName: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(500).default(""),
  icon: z.enum(objectIcons).default("box"),
  primaryKey: propertyKey,
  titleProperty: propertyKey,
  descriptionProperty: propertyKey.optional(),
  properties: z.array(propertySchema).min(1).max(20),
}).strict();
export type ObjectType = z.infer<typeof objectTypeSchema>;
export type ObjectTypeInput = z.input<typeof objectTypeSchema>;
export type Issue = {path: string; message: string};

/** Validates one object type; `known` lists the apiNames that link properties may target. */
export function validateObjectType(input: unknown, known: string[] = []): {ok: true; type: ObjectType} | {ok: false; errors: Issue[]} {
  const parsed = objectTypeSchema.safeParse(input);
  if (!parsed.success) return {ok: false, errors: parsed.error.issues.map(e => ({path: e.path.join("."), message: e.message}))};
  const type = parsed.data, errors: Issue[] = [], keys = type.properties.map(p => p.apiName);
  const byKey = new Map(type.properties.map(p => [p.apiName, p]));
  if (new Set(keys).size !== keys.length) errors.push({path: "properties", message: "属性名重复"});
  const pk = byKey.get(type.primaryKey), title = byKey.get(type.titleProperty);
  if (!pk || pk.baseType !== "string" || !pk.required || pk.readOnly) errors.push({path: "primaryKey", message: "主键必须是可编辑的必填文本属性"});
  if (!title || !["string", "longText"].includes(title.baseType)) errors.push({path: "titleProperty", message: "标题属性必须是文本属性"});
  if (type.descriptionProperty && !byKey.has(type.descriptionProperty)) errors.push({path: "descriptionProperty", message: "描述属性不存在"});
  type.properties.forEach((p, i) => {
    const path = `properties.${i}`;
    if (p.baseType === "enum" && !p.options) errors.push({path: `${path}.options`, message: "枚举属性需要选项"});
    if (p.baseType !== "enum" && p.options) errors.push({path: `${path}.options`, message: "只有枚举属性可以声明选项"});
    if (p.options && new Set(p.options).size !== p.options.length) errors.push({path: `${path}.options`, message: "枚举选项重复"});
    if (p.baseType === "link" && !p.target) errors.push({path: `${path}.target`, message: "关联属性需要目标类型"});
    if (p.baseType === "link" && p.target && p.target !== type.apiName && !known.includes(p.target)) errors.push({path: `${path}.target`, message: `目标类型 ${p.target} 不存在`});
    if (p.baseType !== "link" && p.target) errors.push({path: `${path}.target`, message: "只有关联属性可以声明目标类型"});
    if ((p.min !== undefined || p.max !== undefined) && !["integer", "decimal"].includes(p.baseType)) errors.push({path, message: "数值范围仅用于整数或小数"});
    if ((p.min ?? -1e9) > (p.max ?? 1e9)) errors.push({path, message: "最小值不能大于最大值"});
    if (p.readOnly && p.default === undefined && p.baseType !== "string" && p.baseType !== "longText" && p.baseType !== "date") errors.push({path: `${path}.default`, message: "只读属性需要默认值"});
  });
  if (errors.length) return {ok: false, errors};
  const config = toListDetail(type, [], {}), field = config.fields;
  for (const issue of validateBusinessConfig(config)) errors.push({path: issue.path.replace(/^listDetail\.fields\.(\d+)/, "properties.$1"), message: issue.message});
  type.properties.forEach((p, i) => {
    if (p.default === undefined) return;
    const f = field.find(f => f.key === p.apiName)!;
    if (typeof p.default !== (f.type === "text" ? "string" : f.type) || (f.options && !f.options.some(o => o.value === p.default))) errors.push({path: `properties.${i}.default`, message: "默认值类型或选项不匹配"});
  });
  return errors.length ? {ok: false, errors} : {ok: true, type};
}

export const NONE = "-";
export type LinkOptions = Record<string, {label: string; value: string}[]>;
const plural = (type: ObjectType) => type.pluralDisplayName ?? type.displayName;

function toField(p: Property, links: LinkOptions): RecordField {
  const base = {key: p.apiName, label: p.displayName, required: !!p.required};
  const optional = (options: {label: string; value: RecordValue}[]) => p.required ? options : [{label: "未设置", value: NONE}, ...options];
  switch (p.baseType) {
    case "integer": case "decimal": {
      const min = p.min ?? -1e9, max = p.max ?? 1e9;
      return {...base, type: "number", integer: p.baseType === "integer", min: p.min, max: p.max, default: p.default ?? Math.min(Math.max(0, min), max)};
    }
    case "boolean":
      return {...base, type: "boolean", required: true, trueLabel: p.trueLabel ?? "是", falseLabel: p.falseLabel ?? "否", default: p.default ?? false,
        options: [{label: p.trueLabel ?? "是", value: true}, {label: p.falseLabel ?? "否", value: false}]};
    case "enum": {
      const options = optional(p.options!.map(value => ({label: value, value})));
      return {...base, type: "text", options, default: p.default ?? options[0].value};
    }
    case "link": {
      const options = optional(links[p.target!] ?? []);
      return {...base, type: "text", options: options.length ? options : [{label: "未设置", value: NONE}], default: p.default ?? options[0]?.value ?? NONE};
    }
    case "date": return {...base, type: "text", format: "date", maxLength: 10, default: p.default ?? ""};
    case "longText": return {...base, type: "text", format: "textarea", maxLength: p.maxLength ?? 1000, minLength: p.required ? 1 : undefined, default: p.default ?? ""};
    default: return {...base, type: "text", maxLength: p.maxLength ?? 200, minLength: p.required ? 1 : undefined, default: p.default ?? ""};
  }
}

/** Projects an object type onto the shared list/detail/form runtime configuration. */
export function toListDetail(type: ObjectType, rows: DataRecord[], links: LinkOptions): ListDetail {
  const fields = type.properties.map(p => toField(p, links));
  const strip = (f: RecordField): RecordField => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as RecordField;
  const listed = type.properties.filter(p => p.showInList ?? p.baseType !== "longText");
  const columns = [type.properties.find(p => p.apiName === type.titleProperty)!, ...listed.filter(p => p.apiName !== type.titleProperty && p.apiName !== type.descriptionProperty)].slice(0, 6);
  const filters = type.properties.filter(p => p.filterable ?? ["enum", "boolean", "link"].includes(p.baseType)).slice(0, 3);
  const detail = type.properties.filter(p => p.apiName !== type.titleProperty && p.apiName !== type.descriptionProperty).map(p => p.apiName).slice(0, 20);
  return {
    entityName: type.displayName, dataSource: "example", titleField: type.titleProperty,
    ...(type.descriptionProperty ? {descriptionField: type.descriptionProperty} : {}),
    fields: fields.map(strip),
    columns: columns.map(p => ({field: p.apiName, title: p.displayName})),
    searchFields: type.properties.filter(p => ["string", "longText", "enum"].includes(p.baseType)).map(p => p.apiName).slice(0, 20),
    filters: filters.map(p => p.apiName),
    detailFields: detail.length ? detail : [type.titleProperty],
    form: {fields: type.properties.filter(p => !p.readOnly).map(p => p.apiName), uniqueField: type.primaryKey, actions: [...recordActions]},
    rows,
  };
}

/** Coerces stored data to the current type definition (types may evolve after data exists). */
export function normalizeRow(config: ListDetail, id: string, data: Record<string, unknown>): DataRecord {
  const row: DataRecord = {id};
  for (const f of config.fields) {
    const value = data[f.key], expected = f.type === "text" ? "string" : f.type;
    if (typeof value === expected && (!f.options || f.options.some(o => o.value === value))) row[f.key] = value as RecordValue;
    else if (f.type === "text" && !f.options && value !== undefined && value !== null) row[f.key] = String(value);
    // A removed link target or enum option shows as unset and must be re-chosen on edit.
    else if (f.type === "text" && f.options && typeof value === "string") row[f.key] = NONE;
    else row[f.key] = f.default!;
  }
  return row;
}

export const pageKinds = ["list-detail", "detail", "form"] as const;
export type PageKind = typeof pageKinds[number];
export const pageKindLabels: Record<PageKind, string> = {"list-detail": "列表 + 详情", detail: "独立详情页", form: "新建 / 编辑页"};
export const pageId = (objectType: string, kind: PageKind) => `${objectType}-${kind}`;
export function pageRoute(objectType: string, kind: PageKind, recordId?: string): string {
  return kind === "list-detail" ? `/apps/${objectType}` : kind === "form" ? `/apps/${objectType}/new` : `/apps/${objectType}/${recordId ? encodeURIComponent(recordId) : ""}`;
}

/**
 * Generates the list+detail Page DSL for a type. The stored snapshot keeps the DSL validator's
 * limits (≤30 options, ≤200 rows); at runtime rows and link options are re-hydrated from SQLite.
 */
export function generateListDetailDocument(type: ObjectType, rows: DataRecord[], links: LinkOptions): PageDocument {
  const capped = Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v.slice(0, 29)]));
  const config = toListDetail(type, [], capped);
  const sample = rows.map(row => normalizeRow(config, row.id, row)).filter(row => config.fields.every(f => !f.options || f.options.some(o => o.value === row[f.key]))).slice(0, 50);
  const document = createDocument();
  document.id = `${type.apiName}-page`;
  document.name = `${plural(type)}管理`.slice(0, 80);
  const [workspace, context] = document.root;
  for (const node of workspace.slots.children) {
    if (node.componentRef === "pattern.page-header") node.props = {title: document.name, description: type.description || `管理全部${plural(type)}，支持搜索、筛选、查看详情和编辑。`};
    if (node.componentRef === "composite.search-bar") node.props = {placeholder: `搜索${type.displayName}…`};
  }
  context.props = {title: `${type.displayName}详情`};
  return {...document, listDetail: {...config, rows: sample}};
}

/** Builds an object type from an existing list/detail DSL (used to seed from page templates). */
export function fromListDetail(apiName: string, config: ListDetail, description = ""): ObjectType {
  const primaryKey = config.form?.uniqueField ?? config.titleField;
  const properties: Property[] = config.fields.map(f => {
    const common = {apiName: f.key, displayName: f.label, ...(f.key === primaryKey || f.required ? {required: true} : {}),
      ...(config.form && !config.form.fields.includes(f.key) ? {readOnly: true} : {})};
    if (f.type === "boolean") return {...common, baseType: "boolean" as const, trueLabel: f.trueLabel, falseLabel: f.falseLabel, ...(f.default !== undefined ? {default: f.default} : {})};
    if (f.type === "number") return {...common, baseType: f.integer ? "integer" as const : "decimal" as const, min: f.min, max: f.max, ...(f.default !== undefined ? {default: f.default} : {})};
    const values = f.options?.map(o => String(o.value)) ?? (config.filters.includes(f.key) && f.key !== primaryKey ? [...new Set(config.rows.map(r => String(r[f.key])))].slice(0, 30) : undefined);
    if (values?.length) return {...common, required: true, baseType: "enum" as const, options: values, ...(typeof f.default === "string" && values.includes(f.default) ? {default: f.default} : {})};
    return {...common, baseType: f.key === config.descriptionField ? "longText" as const : "string" as const, ...(typeof f.default === "string" && f.default ? {default: f.default} : {})};
  });
  const clean = properties.map(p => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Property);
  return objectTypeSchema.parse({apiName, displayName: config.entityName, description, primaryKey, titleProperty: config.titleField,
    ...(config.descriptionField ? {descriptionProperty: config.descriptionField} : {}), properties: clean});
}
