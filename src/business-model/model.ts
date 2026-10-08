import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import type { ObjectTypeInput, Property } from "../ontology/model";

/**
 * Business model (BMF-001) imported from a semantic-model YAML. The authored elements (entities,
 * relationships, actions, rules, metrics) keep their source ids and the original YAML object in
 * `raw`, so export writes back every key this module does not model. Roles, states and events are
 * not authored in the source: they are derived on demand and always marked as inferred.
 * Pure module: safe for the browser, the server and tests.
 */
type Raw = Record<string, unknown>;

export const fieldTypes = ["String", "Integer", "Number", "Boolean", "DateTime", "Date", "JSON"] as const;
export type FieldType = typeof fieldTypes[number];
export const fieldTypeLabels: Record<FieldType, string> = {String: "文本", Integer: "整数", Number: "数值", Boolean: "布尔", DateTime: "日期时间", Date: "日期", JSON: "JSON"};

export type FieldConstraints = {required?: boolean; nullable?: boolean; unique?: boolean; enum?: string[]};
export type BmField = {id: string; displayName?: string; type: string; description: string; isTime: boolean; constraints: FieldConstraints; raw: Raw};
export type BmEntity = {id: string; displayName?: string; description: string; source?: string; primaryKey: string[]; uniqueKeys: string[][]; synonyms: string[]; fields: BmField[]; raw: Raw};
export type BmRelationship = {id: string; from: string; to: string; fromColumns: string[]; toColumns: string[]; synonyms: string[]; raw: Raw};
export type BmAction = {
  id: string; name: string; kind: string; operation: string; entity?: string; appliesTo?: string; description: string; labels: string[];
  inputSchema?: JsonSchema; outputSchema?: JsonSchema; roles: string[]; governance?: Raw; raw: Raw;
};
export type BmRule = {
  id: string; name: string; severity: string; scope: {entity?: string; actionIds: string[]; condition?: string};
  constraint?: {type?: string; field?: string; predicate?: string; enforcement?: string}; appliesTo?: string; message: string; remediation: string; raw: Raw;
};
export type BmMetric = {id: string; description: string; expression: string; raw: Raw};
export type JsonSchema = {type?: string; properties?: Record<string, JsonSchema>; required?: string[]; enum?: unknown[]; description?: string; [key: string]: unknown};

/** A binding records that an entity was projected into the app ontology (BMF: 已绑定). */
export type EntityBinding = {objectType: string; boundAt: string};

export type BusinessModel = {
  name: string; description: string; sourceVersion: string; namespace?: string; metadata: Raw;
  entities: BmEntity[]; relationships: BmRelationship[]; actions: BmAction[]; rules: BmRule[]; metrics: BmMetric[];
  bindings: Record<string, EntityBinding>;
  /** Original containers: root document, the semantic model and its behavior block. */
  raw: {root: Raw; semantic: Raw; behavior: Raw};
};

// ── Derived (inferred) views ────────────────────────────────────────────────
export type BmRole = {id: string; actions: string[]; sources: string[]; inferred: true};
export type BmState = {id: string; entity: string; field: string; values: string[]; nullable: boolean; inferred: true};
export type BmEvent = {id: string; name: string; entity: string; field: string; producedBy: string[]; inferred: true};
export type EnumCandidate = {values: string[]; nullable: boolean; inferred: true};

export const views = ["entity", "relationship", "action", "rule", "role", "state", "event", "metric", "process", "document"] as const;
export type View = typeof views[number];
export const viewLabels: Record<View, string> = {
  entity: "业务对象", relationship: "业务关系", action: "业务行为", rule: "业务规则", role: "业务角色",
  state: "业务状态", event: "业务事件", metric: "业务指标", process: "业务流程", document: "业务文档",
};

export type Severity = "error" | "warning" | "info";
export type ModelIssue = {severity: Severity; path: string; message: string; element?: {view: View; id: string}};

/** BMF-001 §8.3 completeness: 定义 / 校验 / 实现（绑定） / 验证. */
export type Completeness = {defined: boolean; validation: "validated" | "blocked"; bound: boolean; verified: boolean};

// ── Parsing ─────────────────────────────────────────────────────────────────
const isObject = (value: unknown): value is Raw => !!value && typeof value === "object" && !Array.isArray(value);
const str = (value: unknown): string => typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.map(str) : [];
const objects = (value: unknown): Raw[] => Array.isArray(value) ? value.filter(isObject) : [];
const synonymsOf = (raw: Raw) => strings(isObject(raw.ai_context) ? raw.ai_context.synonyms : undefined);

export type ParseResult = {ok: true; model: BusinessModel; issues: ModelIssue[]} | {ok: false; issues: ModelIssue[]};

/** Parses YAML text; structural problems that prevent import are returned as error issues. */
export function parseBusinessModelYaml(text: string): ParseResult {
  let root: unknown;
  try { root = parseYaml(text, {maxAliasCount: 10_000}); }
  catch (error) { return {ok: false, issues: [{severity: "error", path: "", message: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`}]}; }
  return fromRaw(root);
}

export function fromRaw(input: unknown): ParseResult {
  if (!isObject(input)) return {ok: false, issues: [{severity: "error", path: "", message: "根节点必须是对象"}]};
  // Detach from YAML alias identity so later edits never leak across shared anchors.
  const root = structuredClone(input) as Raw;
  const models = objects(root.semantic_model);
  if (!models.length) return {ok: false, issues: [{severity: "error", path: "semantic_model", message: "缺少 semantic_model[0]"}]};
  const semantic = models[0], behavior = isObject(semantic.behavior) ? semantic.behavior : {};
  const name = str(semantic.name);
  if (!name) return {ok: false, issues: [{severity: "error", path: "semantic_model[0].name", message: "模型缺少 name"}]};
  const issues: ModelIssue[] = [];
  if (models.length > 1) issues.push({severity: "info", path: "semantic_model", message: `仅导入第一个语义模型；其余 ${models.length - 1} 个原样保留在导出中`});

  const entities = objects(semantic.datasets).map((raw): BmEntity => ({
    id: str(raw.name), displayName: raw.display_name === undefined ? undefined : str(raw.display_name), description: str(raw.description),
    source: raw.source === undefined ? undefined : str(raw.source), primaryKey: strings(raw.primary_key),
    uniqueKeys: Array.isArray(raw.unique_keys) ? raw.unique_keys.map(strings) : [], synonyms: synonymsOf(raw),
    fields: objects(raw.fields).map((f): BmField => ({
      id: str(f.name), displayName: f.display_name === undefined ? undefined : str(f.display_name), type: str(f.type), description: str(f.description),
      isTime: isObject(f.dimension) && f.dimension.is_time === true, constraints: isObject(f.constraints) ? readConstraints(f.constraints) : {}, raw: f,
    })),
    raw,
  }));
  const relationships = objects(semantic.relationships).map((raw): BmRelationship => ({
    id: str(raw.name), from: str(raw.from), to: str(raw.to), fromColumns: strings(raw.from_columns), toColumns: strings(raw.to_columns), synonyms: synonymsOf(raw), raw,
  }));
  const metrics = objects(semantic.metrics).map((raw): BmMetric => ({id: str(raw.name), description: str(raw.description), expression: expressionOf(raw.expression), raw}));
  const actions = objects(behavior.actions).map((raw): BmAction => {
    const io = isObject(raw.io_schema) ? raw.io_schema : {}, auth = isObject(raw.authorization) ? raw.authorization : {};
    const applies = isObject(raw.applies_to) ? raw.applies_to : {};
    return {
      id: str(raw.id), name: str(raw.name), kind: str(raw.kind), operation: str(raw.operation),
      entity: raw.entity_name === undefined ? undefined : str(raw.entity_name), appliesTo: applies.dataset === undefined ? undefined : str(applies.dataset),
      description: str(raw.description), labels: strings(raw.labels),
      inputSchema: isObject(io.input_schema) ? io.input_schema as JsonSchema : undefined, outputSchema: isObject(io.output_schema) ? io.output_schema as JsonSchema : undefined,
      roles: strings(auth.allowed_roles), governance: isObject(raw.governance) ? raw.governance : undefined, raw,
    };
  });
  const rules = objects(behavior.rules).map((raw): BmRule => {
    const when = isObject(raw.when) ? raw.when : {}, constraint = isObject(raw.constraint) ? raw.constraint : undefined, applies = isObject(raw.applies_to) ? raw.applies_to : {};
    return {
      id: str(raw.id), name: str(raw.name), severity: str(raw.severity),
      scope: {entity: when.entity === undefined ? undefined : str(when.entity), actionIds: strings(when.action_ids), condition: when.condition === undefined ? undefined : str(when.condition)},
      constraint: constraint && {type: optional(constraint.type), field: optional(constraint.field), predicate: optional(constraint.predicate), enforcement: optional(constraint.enforcement)},
      appliesTo: applies.dataset === undefined ? undefined : str(applies.dataset), message: str(raw.message), remediation: str(raw.remediation), raw,
    };
  });
  const model: BusinessModel = {
    name, description: str(semantic.description), sourceVersion: str(root.version), namespace: behavior.namespace === undefined ? undefined : str(behavior.namespace),
    metadata: isObject(behavior.metadata) ? behavior.metadata : {}, entities, relationships, actions, rules, metrics, bindings: {}, raw: {root, semantic, behavior},
  };
  return {ok: true, model, issues: [...issues, ...validateBusinessModel(model)]};
}

const optional = (value: unknown) => value === undefined ? undefined : str(value);
function expressionOf(value: unknown): string {
  if (!isObject(value)) return str(value);
  const dialects = objects(value.dialects);
  return str((dialects.find(d => d.dialect === "ANSI_SQL") ?? dialects[0])?.expression);
}
function readConstraints(raw: Raw): FieldConstraints {
  const out: FieldConstraints = {};
  for (const key of ["required", "nullable", "unique"] as const) if (typeof raw[key] === "boolean") out[key] = raw[key] as boolean;
  if (Array.isArray(raw.enum)) out.enum = strings(raw.enum);
  return out;
}

// ── Export ──────────────────────────────────────────────────────────────────
/** Writes `value` at `key`, keeping the key's original position; an empty value never adds a key the source did not have. */
function put(target: Raw, key: string, value: unknown): void {
  if (value === undefined || (value === "" && !(key in target))) delete target[key]; else target[key] = value;
}
function assign(raw: Raw, values: Raw): Raw {
  const out = structuredClone(raw);
  for (const [key, value] of Object.entries(values)) put(out, key, value);
  return out;
}
const constraintKeys = ["required", "nullable", "unique", "enum"];
function constraintsRaw(field: BmField): unknown {
  const source = isObject(field.raw.constraints) ? field.raw.constraints : {};
  const rest = Object.fromEntries(Object.entries(source).filter(([key]) => !constraintKeys.includes(key)));
  const merged = {...rest, ...field.constraints};
  return Object.keys(merged).length ? merged : undefined;
}

export function toRaw(model: BusinessModel): Raw {
  const root = structuredClone(model.raw.root);
  const semantic = assign(model.raw.semantic, {name: model.name, description: model.description});
  semantic.datasets = model.entities.map(e => assign(e.raw, {
    name: e.id, display_name: e.displayName, description: e.description, primary_key: e.primaryKey,
    fields: e.fields.map(f => assign(f.raw, {name: f.id, display_name: f.displayName, type: f.type, description: f.description, constraints: constraintsRaw(f)})),
  }));
  if ("relationships" in semantic || model.relationships.length) semantic.relationships = model.relationships.map(r => structuredClone(r.raw));
  if ("metrics" in semantic || model.metrics.length) semantic.metrics = model.metrics.map(m => assign(m.raw, {description: m.description}));
  if ("behavior" in semantic) semantic.behavior = assign(model.raw.behavior, {
    actions: model.actions.map(a => assign(a.raw, {name: a.name, description: a.description})),
    rules: model.rules.map(r => assign(r.raw, {name: r.name, severity: r.severity, message: r.message, remediation: r.remediation})),
  });
  root.semantic_model = [semantic, ...objects(root.semantic_model).slice(1)];
  return root;
}

export function toYaml(model: BusinessModel): string {
  return stringifyYaml(toRaw(model), {lineWidth: 0, aliasDuplicateObjects: false});
}

// ── Inference ───────────────────────────────────────────────────────────────
const enumPattern = /^([A-Z][A-Z0-9_]*(?:\/[A-Z][A-Z0-9_]*)+)(.*)$/;
/** "ACTIVE/SUSPENDED/CLOSED" in a field description → enum candidate (inferred, BMF §8.2 needs it confirmed). */
export function enumCandidate(field: BmField): EnumCandidate | undefined {
  const match = enumPattern.exec(field.description.trim());
  if (!match) return undefined;
  return {values: match[1].split("/"), nullable: /空|null/i.test(match[2]), inferred: true};
}
/** Enum values in effect: confirmed constraint first, inferred candidate otherwise. */
export function enumValues(field: BmField): {values: string[]; inferred: boolean} | undefined {
  if (field.constraints.enum?.length) return {values: field.constraints.enum, inferred: false};
  const candidate = enumCandidate(field);
  return candidate && {values: candidate.values, inferred: true};
}

export function inferRoles(model: BusinessModel): BmRole[] {
  const roles = new Map<string, BmRole>();
  const role = (id: string) => roles.get(id) ?? roles.set(id, {id, actions: [], sources: [], inferred: true}).get(id)!;
  for (const action of model.actions) for (const id of action.roles) {
    const r = role(id); r.actions.push(action.id);
    if (!r.sources.includes("authorization.allowed_roles")) r.sources.push("authorization.allowed_roles");
  }
  for (const entity of model.entities) for (const field of entity.fields) {
    if (!/role/.test(field.id)) continue;
    for (const id of enumValues(field)?.values ?? []) { const source = `${entity.id}.${field.id}`, r = role(id); if (!r.sources.includes(source)) r.sources.push(source); }
  }
  return [...roles.values()];
}

/** Status-like enum fields become lifecycle state candidates; transitions are not in the source. */
export function inferStates(model: BusinessModel): BmState[] {
  return model.entities.flatMap(entity => entity.fields.flatMap(field => {
    if (!/(^|_)status$/.test(field.id)) return [];
    const values = enumValues(field);
    return values ? [{id: `state/${entity.id}.${field.id}`, entity: entity.id, field: field.id, values: values.values, nullable: !!enumCandidate(field)?.nullable, inferred: true as const}] : [];
  }));
}

/** `*_event` datasets with an event type enum yield business events; audit_event is execution audit, not a business fact (BMF §4.3). */
export function inferEvents(model: BusinessModel): BmEvent[] {
  return model.entities.filter(e => /_event$/.test(e.id) && e.id !== "audit_event").flatMap(entity => {
    const field = entity.fields.find(f => /(^|_)type$/.test(f.id) && enumValues(f));
    if (!field) return [];
    return enumValues(field)!.values.map(value => ({
      id: `event/${entity.id}.${value}`, name: value, entity: entity.id, field: field.id, inferred: true as const,
      producedBy: model.actions.filter(a => a.kind === "command" && new RegExp(`(^|[^A-Z_])${value}([^A-Z_]|$)`).test(a.description) && /事件/.test(a.description)).map(a => a.id),
    }));
  });
}

// ── Validation ──────────────────────────────────────────────────────────────
const semanticPath = "semantic_model[0]";
export function validateBusinessModel(model: BusinessModel): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const add = (severity: Severity, path: string, message: string, element?: ModelIssue["element"]) => issues.push({severity, path, message, element});
  const entities = new Map(model.entities.map(e => [e.id, e]));
  const fieldsOf = (id: string) => new Set(entities.get(id)?.fields.map(f => f.id) ?? []);
  const actions = new Set(model.actions.map(a => a.id));
  const duplicates = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

  model.entities.forEach((entity, i) => {
    const path = `${semanticPath}.datasets[${i}]`, element = {view: "entity" as const, id: entity.id};
    if (!entity.id) add("error", `${path}.name`, "对象缺少 name", element);
    if (!entity.description) add("warning", `${path}.description`, "对象缺少业务定义", element);
    const fields = new Set(entity.fields.map(f => f.id));
    for (const id of duplicates(entity.fields.map(f => f.id))) add("error", `${path}.fields`, `字段 ${id} 重复`, element);
    if (!entity.primaryKey.length) add("error", `${path}.primary_key`, "对象缺少主键（身份）", element);
    entity.primaryKey.forEach((key, k) => { if (!fields.has(key)) add("error", `${path}.primary_key[${k}]`, `主键字段 ${key} 不存在`, element); });
    entity.uniqueKeys.forEach((keys, k) => keys.forEach((key, j) => { if (!fields.has(key)) add("error", `${path}.unique_keys[${k}][${j}]`, `唯一键字段 ${key} 不存在`, element); }));
    entity.fields.forEach((field, j) => {
      if (!(fieldTypes as readonly string[]).includes(field.type)) add("warning", `${path}.fields[${j}].type`, `未知字段类型 ${field.type || "（空）"}`, element);
      const values = field.constraints.enum;
      if (values && new Set(values).size !== values.length) add("error", `${path}.fields[${j}].constraints.enum`, "枚举值重复", element);
    });
  });
  for (const id of duplicates(model.entities.map(e => e.id))) add("error", `${semanticPath}.datasets`, `对象 ${id} 重复`, {view: "entity", id});

  model.relationships.forEach((rel, i) => {
    const path = `${semanticPath}.relationships[${i}]`, element = {view: "relationship" as const, id: rel.id};
    for (const [side, dataset, columns] of [["from", rel.from, rel.fromColumns], ["to", rel.to, rel.toColumns]] as const) {
      if (!entities.has(dataset)) { add("error", `${path}.${side}`, `关系引用的对象 ${dataset || "（空）"} 不存在`, element); continue; }
      const fields = fieldsOf(dataset);
      columns.forEach((column, k) => { if (!fields.has(column)) add("error", `${path}.${side}_columns[${k}]`, `字段 ${dataset}.${column} 不存在`, element); });
    }
    if (rel.fromColumns.length !== rel.toColumns.length) add("error", path, "关联键数量不一致", element);
    if (!rel.fromColumns.length) add("error", `${path}.from_columns`, "关系缺少关联键", element);
  });
  for (const id of duplicates(model.relationships.map(r => r.id))) add("error", `${semanticPath}.relationships`, `关系 ${id} 重复`, {view: "relationship", id});

  model.actions.forEach((action, i) => {
    const path = `${semanticPath}.behavior.actions[${i}]`, element = {view: "action" as const, id: action.id};
    if (!["query", "command"].includes(action.kind)) add("error", `${path}.kind`, `kind 必须是 query 或 command，实际为 ${action.kind || "（空）"}`, element);
    if (action.entity && !entities.has(action.entity)) add("error", `${path}.entity_name`, `操作引用的对象 ${action.entity} 不存在`, element);
    if (action.appliesTo && !entities.has(action.appliesTo)) add("error", `${path}.applies_to.dataset`, `操作适用的对象 ${action.appliesTo} 不存在`, element);
    if (action.entity && action.appliesTo && action.entity !== action.appliesTo) add("warning", `${path}.applies_to.dataset`, `entity_name（${action.entity}）与 applies_to（${action.appliesTo}）不一致`, element);
    if (!action.roles.length) add("warning", `${path}.authorization.allowed_roles`, "操作未声明可执行角色", element);
    if (!action.inputSchema) add("warning", `${path}.io_schema.input_schema`, "操作缺少输入合同", element);
    const props = action.inputSchema?.properties ?? {};
    (action.inputSchema?.required ?? []).forEach((key, k) => { if (!(key in props)) add("error", `${path}.io_schema.input_schema.required[${k}]`, `必填输入 ${key} 未在 properties 中定义`, element); });
  });
  for (const id of duplicates(model.actions.map(a => a.id))) add("error", `${semanticPath}.behavior.actions`, `操作 ${id} 重复`, {view: "action", id});

  model.rules.forEach((rule, i) => {
    const path = `${semanticPath}.behavior.rules[${i}]`, element = {view: "rule" as const, id: rule.id};
    if (rule.appliesTo && !entities.has(rule.appliesTo)) add("error", `${path}.applies_to.dataset`, `规则适用的对象 ${rule.appliesTo} 不存在`, element);
    rule.scope.actionIds.forEach((id, k) => { if (!actions.has(id)) add("error", `${path}.when.action_ids[${k}]`, `规则引用的操作 ${id} 不存在`, element); });
    if (rule.scope.entity === "action" && !rule.scope.actionIds.length) add("warning", `${path}.when.action_ids`, "操作列表为空：不能默认为适用全部或不适用任何（BMF §8.2），需要明确作用域", element);
    const field = rule.constraint?.field;
    if (field) {
      const [dataset, column] = field.split(".");
      if (!entities.has(dataset)) add("error", `${path}.constraint.field`, `约束字段引用的对象 ${dataset} 不存在`, element);
      else if (column && !fieldsOf(dataset).has(column)) add("error", `${path}.constraint.field`, `约束字段 ${field} 不存在`, element);
    }
  });
  for (const id of duplicates(model.rules.map(r => r.id))) add("error", `${semanticPath}.behavior.rules`, `规则 ${id} 重复`, {view: "rule", id});

  model.metrics.forEach((metric, i) => {
    const path = `${semanticPath}.metrics[${i}]`, element = {view: "metric" as const, id: metric.id};
    if (!metric.expression) add("error", `${path}.expression`, "指标缺少表达式", element);
    for (const [, dataset, column] of metric.expression.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
      if (entities.has(dataset) && !fieldsOf(dataset).has(column)) add("error", `${path}.expression`, `指标引用的字段 ${dataset}.${column} 不存在`, element);
    }
  });
  return issues;
}

// ── Summary ─────────────────────────────────────────────────────────────────
export type ModelCounts = Record<View, number> & {fields: number; queries: number; commands: number; inferredEnums: number};
export function countModel(model: BusinessModel): ModelCounts {
  return {
    entity: model.entities.length, relationship: model.relationships.length, action: model.actions.length, rule: model.rules.length,
    role: inferRoles(model).length, state: inferStates(model).length, event: inferEvents(model).length, metric: model.metrics.length, process: 0, document: 0,
    fields: model.entities.reduce((sum, e) => sum + e.fields.length, 0),
    queries: model.actions.filter(a => a.kind === "query").length, commands: model.actions.filter(a => a.kind === "command").length,
    inferredEnums: model.entities.reduce((sum, e) => sum + e.fields.filter(f => enumValues(f)?.inferred).length, 0),
  };
}

export function completeness(model: BusinessModel, view: View, id: string, issues: ModelIssue[]): Completeness {
  const blocked = issues.some(i => i.severity === "error" && i.element?.view === view && i.element.id === id);
  let defined = false;
  if (view === "entity") { const e = model.entities.find(x => x.id === id); defined = !!e && !!e.description && e.primaryKey.length > 0 && e.fields.length > 0; }
  if (view === "relationship") { const r = model.relationships.find(x => x.id === id); defined = !!r && !!r.from && !!r.to && r.fromColumns.length > 0; }
  if (view === "action") { const a = model.actions.find(x => x.id === id); defined = !!a && !!a.description && !!a.inputSchema && !!a.outputSchema && a.roles.length > 0; }
  if (view === "rule") { const r = model.rules.find(x => x.id === id); defined = !!r && !!r.constraint?.predicate && (!!r.appliesTo || r.scope.actionIds.length > 0); }
  if (view === "metric") { const m = model.metrics.find(x => x.id === id); defined = !!m && !!m.expression && !!m.description; }
  return {defined, validation: blocked ? "blocked" : "validated", bound: view === "entity" && !!model.bindings[id], verified: false};
}

// ── Labels ──────────────────────────────────────────────────────────────────
export const entityLabel = (e: BmEntity) => e.displayName || e.synonyms[0] || e.id;
/** Short business label for a field: explicit display name, else the description up to the first comma (not an enum list). */
export function fieldLabel(field: BmField): string {
  if (field.displayName) return field.displayName;
  if (enumCandidate(field) || !field.description) return field.id;
  return field.description.split(/[，,；;（(]/)[0].trim() || field.id;
}

// ── Edits ───────────────────────────────────────────────────────────────────
const text = (max: number) => z.string().max(max);
const name = z.string().trim().min(1).max(80);
export const modelPatchSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("model"), description: text(2000).optional()}).strict(),
  z.object({kind: z.literal("entity"), id: z.string(), displayName: name.optional().nullable(), description: text(2000).optional()}).strict(),
  z.object({
    kind: z.literal("field"), entity: z.string(), id: z.string(), displayName: name.optional().nullable(), description: text(2000).optional(),
    constraints: z.object({required: z.boolean().optional(), nullable: z.boolean().optional(), unique: z.boolean().optional(), enum: z.array(z.string().trim().min(1).max(60)).max(50).optional()}).strict().optional(),
  }).strict(),
  z.object({kind: z.literal("action"), id: z.string(), name: name.optional(), description: text(4000).optional()}).strict(),
  z.object({kind: z.literal("rule"), id: z.string(), name: name.optional(), severity: z.enum(["error", "warning", "info"]).optional(), message: text(2000).optional(), remediation: text(2000).optional()}).strict(),
  z.object({kind: z.literal("metric"), id: z.string(), description: text(2000).optional()}).strict(),
]);
export type ModelPatch = z.infer<typeof modelPatchSchema>;
type PatchResult = {ok: true; model: BusinessModel} | {ok: false; issues: ModelIssue[]};

/** Applies edits immutably. Stable ids are never rewritten (BMF §4.1): only names, definitions and constraints change. */
export function applyPatches(model: BusinessModel, patches: unknown[]): PatchResult {
  const next = structuredClone(model);
  for (const [index, input] of patches.entries()) {
    const parsed = modelPatchSchema.safeParse(input);
    if (!parsed.success) return {ok: false, issues: parsed.error.issues.map(e => ({severity: "error", path: `patches[${index}].${e.path.join(".")}`, message: e.message}))};
    const patch = parsed.data, missing = (what: string): PatchResult => ({ok: false, issues: [{severity: "error", path: `patches[${index}].id`, message: `${what}不存在`}]});
    if (patch.kind === "model") { if (patch.description !== undefined) next.description = patch.description; continue; }
    if (patch.kind === "entity" || patch.kind === "field") {
      const entity = next.entities.find(e => e.id === (patch.kind === "entity" ? patch.id : patch.entity));
      if (!entity) return missing("对象");
      const target = patch.kind === "entity" ? entity : entity.fields.find(f => f.id === patch.id);
      if (!target) return missing("字段");
      if (patch.displayName !== undefined) target.displayName = patch.displayName ?? undefined;
      if (patch.description !== undefined) target.description = patch.description;
      if (patch.kind === "field" && patch.constraints) {
        // Checked = declared; false or an empty enum clears the declaration (not stated ≠ confirmed false).
        const field = target as BmField, constraints: FieldConstraints = {...field.constraints, ...patch.constraints};
        for (const key of ["required", "nullable", "unique"] as const) if (!constraints[key]) delete constraints[key];
        if (!constraints.enum?.length) delete constraints.enum;
        field.constraints = constraints;
      }
      continue;
    }
    const list = patch.kind === "action" ? next.actions : patch.kind === "rule" ? next.rules : next.metrics;
    const target = (list as {id: string}[]).find(x => x.id === patch.id) as Record<string, unknown> | undefined;
    if (!target) return missing(patch.kind === "action" ? "操作" : patch.kind === "rule" ? "规则" : "指标");
    for (const [key, value] of Object.entries(patch)) if (key !== "kind" && key !== "id" && value !== undefined) target[key] = value;
  }
  return {ok: true, model: next};
}

// ── Bridge to app design ────────────────────────────────────────────────────
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const objectTypeName = (model: BusinessModel, entityId: string) => `${slug(model.name)}-${slug(entityId)}`.replace(/^[^a-z]+/, "").slice(0, 40).replace(/-+$/, "");
const clip = (value: string, max: number) => value.length > max ? value.slice(0, max) : value;

/**
 * Converts one entity into an ontology ObjectType so the existing page generation can project it.
 * Single-column relationships become links when the target entity is already bound; enum fields use
 * the confirmed constraint or the inferred candidate.
 */
export function toObjectType(model: BusinessModel, entityId: string, boundTypes: Record<string, string> = {}): {ok: true; type: ObjectTypeInput; skipped: string[]} | {ok: false; message: string} {
  const entity = model.entities.find(e => e.id === entityId);
  if (!entity) return {ok: false, message: `对象 ${entityId} 不存在`};
  if (entity.primaryKey.length !== 1) return {ok: false, message: "页面生成需要单字段主键"};
  const pk = entity.primaryKey[0], skipped: string[] = [];
  const links = new Map(model.relationships.filter(r => r.from === entity.id && r.fromColumns.length === 1 && boundTypes[r.to]).map(r => [r.fromColumns[0], boundTypes[r.to]]));
  const valid = entity.fields.filter(f => {
    const ok = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(f.id) && !["id", "__proto__", "constructor", "prototype"].includes(f.id);
    if (!ok) skipped.push(f.id);
    return ok;
  });
  if (valid.length > 20) skipped.push(...valid.splice(20).map(f => f.id));
  const properties: Property[] = valid.map(field => {
    const base = {apiName: field.id, displayName: clip(fieldLabel(field), 40), ...(field.id === pk || field.constraints.required ? {required: true} : {})};
    const values = enumValues(field)?.values;
    if (field.id !== pk && links.has(field.id)) return {...base, baseType: "link", target: links.get(field.id)!};
    if (field.id !== pk && values && values.length <= 30 && values.every(v => v.length <= 40)) return {...base, baseType: "enum", options: [...new Set(values)]};
    switch (field.type) {
      case "Integer": return {...base, baseType: "integer"};
      case "Number": return {...base, baseType: "decimal"};
      case "Boolean": return {...base, baseType: "boolean"};
      case "Date": case "DateTime": return {...base, baseType: "date"};
      case "JSON": return {...base, baseType: "longText"};
      default: return {...base, baseType: field.id === pk ? "string" : field.description.length > 60 ? "longText" : "string"};
    }
  });
  if (!properties.some(p => p.apiName === pk)) return {ok: false, message: `主键 ${pk} 无法转换为属性`};
  const textProps = properties.filter(p => p.baseType === "string" && p.apiName !== pk);
  const title = textProps.find(p => /(name|title|code|_no)$/.test(p.apiName)) ?? properties.find(p => p.apiName === pk)!;
  return {ok: true, skipped, type: {
    apiName: objectTypeName(model, entity.id), displayName: clip(entityLabel(entity), 20), pluralDisplayName: clip(entityLabel(entity), 40),
    description: clip(entity.description, 500), icon: "box", primaryKey: pk, titleProperty: title.apiName, properties,
  }};
}
