import { z } from "zod";
import { objectIcons, type ObjectTypeInput } from "../ontology/model";
import type { DataRecord } from "../runtime/data";
import { enumValues, entityLabel, inferRoles, type BusinessModel } from "./model";
import type { ScenarioDraft } from "./sandbox";

/**
 * One-click conversion of a business model into app design (BMF §9: 系统设计). The built-in AI
 * proposes which entities become app modules and how they are presented (names, icon, title,
 * list columns, field labels); the plan is checked against the model and then projected through
 * the existing ontology → page generation path. Without AI a rule-based plan is used.
 */
const id = z.string().trim().min(1).max(80);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).catch([] as z.infer<T>[]).default([] as z.infer<T>[]);

export const appModuleSchema = z.object({
  entity: id,
  displayName: z.string().trim().min(1).max(20),
  pluralDisplayName: z.string().trim().min(1).max(40).optional().catch(undefined),
  icon: z.enum(objectIcons).catch("box").default("box"),
  titleField: id.optional().catch(undefined),
  listFields: list(id, 8),
  fieldLabels: z.record(z.string(), z.string().trim().min(1).max(40)).catch({}).default({}),
  /** Realistic example values for text fields, used for the generated sample records. */
  samples: z.record(z.string(), z.array(z.string().trim().min(1).max(80)).max(5)).catch({}).default({}),
  reason: z.string().trim().max(300).default(""),
  scenarios: list(id, 12),
});
export const appDesignPlanSchema = z.object({
  appName: z.string().trim().min(1).max(40),
  summary: z.string().trim().max(800).default(""),
  modules: z.array(appModuleSchema).min(1).max(30),
  skipped: list(z.object({entity: id, reason: z.string().trim().max(300).default("")}), 30),
});
export type AppModule = z.infer<typeof appModuleSchema>;
export type AppDesignPlan = z.infer<typeof appDesignPlanSchema>;
export type PlanIssue = {severity: "error" | "warning"; path: string; message: string};

/** Generated app design stored on the business model (the binding layer, not exported to YAML). */
export type AppDesign = {
  plan: AppDesignPlan; source: string; generatedAt: string; issues: PlanIssue[];
  modules: {entity: string; objectType: string; pages: number; records: number}[];
};

export function appDesignPrompt(model: BusinessModel, context: string, scenarios: ScenarioDraft[]): {system: string; user: string} {
  const icons = objectIcons.join(" / ");
  const system = `你是应用设计师，按《业务模型设计框架 BMF-001》§9 把业务模型转换为管理后台的应用设计。
每个模块对应一个业务对象（entity），系统会为它生成「列表 + 详情」「独立详情」「新建 / 编辑」页面。
要求：
1. entity、titleField、listFields、fieldLabels 的键必须是模型中已存在的对象 id 与字段名，不得编造。
2. 选择对业务用户有操作价值的对象作为模块；纯技术或审计类对象可以跳过，但要在 skipped 中说明理由。
3. displayName 用简洁中文（≤8 字），pluralDisplayName 用于导航（不要以「管理」结尾，页面标题会自动追加）；icon 只能从 ${icons} 中选择。
4. titleField 选最能识别一条记录的文本字段（名称、标题、编号）；listFields 选 3–6 个列表列，不含主键与长文本。
5. fieldLabels 为字段给出中文标签（≤10 字），不要把枚举值列表当作标签。
6. samples 为标题字段和主要文本字段（不含主键、ID、枚举）各给出 3 个符合业务的示例值，用于生成示例记录。
7. scenarios 写该模块支撑的沙盘场景 id（如有）。
只输出一个 json 对象：{"appName":"","summary":"","modules":[{"entity":"","displayName":"","pluralDisplayName":"","icon":"box","titleField":"","listFields":[""],"fieldLabels":{"field":"标签"},"samples":{"field":["示例1","示例2","示例3"]},"reason":"","scenarios":[""]}],"skipped":[{"entity":"","reason":""}]}`;
  const fields = model.entities.map(e => `- ${e.id}（${entityLabel(e)}）：${e.fields.map(f => `${f.id}:${f.type}${e.primaryKey.includes(f.id) ? "(PK)" : ""}「${f.description.slice(0, 24)}」`).join("，")}`);
  const user = [
    context, "", "## 对象字段明细", ...fields, "",
    scenarios.length ? `## 沙盘场景\n${scenarios.map(s => `- ${s.id}：${s.name}（${s.actors.join("/")}）涉及 ${[...new Set(s.steps.flatMap(st => [...st.reads, ...st.writes]))].join(",")}`).join("\n")}` : "",
    `## 角色：${inferRoles(model).map(r => r.id).join("、")}`,
    "请给出应用设计方案。",
  ].join("\n");
  return {system, user};
}

/** Checks the plan against the model. Unknown references are dropped from the plan and reported. */
export function checkPlan(model: BusinessModel, input: AppDesignPlan): {plan: AppDesignPlan; issues: PlanIssue[]} {
  const issues: PlanIssue[] = [], seen = new Set<string>();
  const entities = new Map(model.entities.map(e => [e.id, e]));
  const modules = input.modules.flatMap((module, i): AppModule[] => {
    const path = `modules[${i}]`, entity = entities.get(module.entity);
    if (!entity) { issues.push({severity: "error", path: `${path}.entity`, message: `对象 ${module.entity} 不存在，已忽略该模块`}); return []; }
    if (seen.has(module.entity)) { issues.push({severity: "warning", path: `${path}.entity`, message: `对象 ${module.entity} 重复，已忽略`}); return []; }
    seen.add(module.entity);
    const fields = new Set(entity.fields.map(f => f.id));
    const keep = (name: string, where: string) => { const ok = fields.has(name); if (!ok) issues.push({severity: "warning", path: `${path}.${where}`, message: `字段 ${module.entity}.${name} 不存在，已忽略`}); return ok; };
    return [{
      ...module,
      titleField: module.titleField && keep(module.titleField, "titleField") ? module.titleField : undefined,
      listFields: module.listFields.filter(f => keep(f, "listFields")),
      fieldLabels: Object.fromEntries(Object.entries(module.fieldLabels).filter(([f]) => keep(f, `fieldLabels.${f}`))),
      samples: Object.fromEntries(Object.entries(module.samples).filter(([f]) => keep(f, `samples.${f}`))),
    }];
  });
  const skipped = input.skipped.filter((s, i) => {
    if (!entities.has(s.entity)) { issues.push({severity: "warning", path: `skipped[${i}]`, message: `对象 ${s.entity} 不存在`}); return false; }
    return !seen.has(s.entity);
  });
  const mentioned = new Set([...seen, ...skipped.map(s => s.entity)]);
  for (const e of model.entities) if (!mentioned.has(e.id)) issues.push({severity: "warning", path: "modules", message: `方案未说明对象 ${e.id} 是否生成模块`});
  return {plan: {...input, modules, skipped}, issues};
}

const iconFor = (entityId: string): AppModule["icon"] =>
  /book|title|copy/.test(entityId) ? "book" : /user|role/.test(entityId) ? "user" : /loan|event|task/.test(entityId) ? "calendar"
    : /supplier/.test(entityId) ? "building" : /order|receipt|line/.test(entityId) ? "package" : /policy|budget/.test(entityId) ? "file" : "box";

/** Deterministic plan used when no AI provider is configured: every entity except execution audit. */
export function ruleBasedPlan(model: BusinessModel): AppDesignPlan {
  const audit = (id: string) => id === "audit_event";
  return {
    appName: `${model.name} 管理后台`, summary: "未配置 AI 模型，按规则生成：每个业务对象一个模块，审计对象除外。",
    modules: model.entities.filter(e => !audit(e.id)).map(e => {
      const text = e.fields.filter(f => f.type === "String" && !e.primaryKey.includes(f.id) && !enumValues(f));
      const title = text.find(f => /(name|title|code|_no|barcode)$/.test(f.id));
      return {
        entity: e.id, displayName: entityLabel(e).slice(0, 20), pluralDisplayName: entityLabel(e).slice(0, 40), icon: iconFor(e.id), titleField: title?.id,
        listFields: e.fields.filter(f => !e.primaryKey.includes(f.id) && f.id !== title?.id && f.type !== "JSON").slice(0, 5).map(f => f.id),
        fieldLabels: {}, samples: {}, reason: "规则生成", scenarios: [],
      };
    }),
    skipped: model.entities.filter(e => audit(e.id)).map(e => ({entity: e.id, reason: "执行审计记录，不作为业务操作模块（BMF §4.3）"})),
  };
}

/** Navigation/page names get "管理" appended by page generation; drop it from the plan's name. */
const plural = (module: AppModule) => (module.pluralDisplayName ?? module.displayName).replace(/管理$/, "") || module.displayName;

/** Applies a module's presentation choices to the projected object type. */
export function applyModule(type: ObjectTypeInput, module: AppModule): ObjectTypeInput {
  const byKey = new Map(type.properties.map(p => [p.apiName, p]));
  const listed = module.listFields.filter(f => byKey.has(f));
  const order = [type.primaryKey, ...listed, ...type.properties.map(p => p.apiName)].filter((key, i, all) => all.indexOf(key) === i);
  const title = module.titleField && ["string", "longText"].includes(byKey.get(module.titleField)?.baseType ?? "") ? module.titleField : type.titleProperty;
  return {
    ...type, displayName: module.displayName, pluralDisplayName: plural(module), icon: module.icon, titleProperty: title,
    properties: order.map(key => {
      const p = byKey.get(key)!, label = module.fieldLabels[key];
      return {...p, ...(label ? {displayName: label} : {}), ...(listed.length ? {showInList: key === title || listed.includes(key)} : {})};
    }),
  };
}

/**
 * Example rows so generated pages are usable: three per module, primary keys like `LOAN-001`,
 * link fields pointing at the target module's rows, enum values cycling through their options.
 */
export function sampleRows(type: ObjectTypeInput, prefix: string, targets: Record<string, string>, samples: Record<string, string[]> = {}, count = 3): DataRecord[] {
  return Array.from({length: count}, (_, i) => {
    const row: DataRecord = {id: `${prefix}-${String(i + 1).padStart(3, "0")}`};
    for (const p of type.properties) {
      if (p.apiName === type.primaryKey) row[p.apiName] = row.id;
      else if (p.baseType === "link") row[p.apiName] = targets[p.target!] ? `${targets[p.target!]}-${String((i % count) + 1).padStart(3, "0")}` : "";
      else if (p.baseType === "enum") row[p.apiName] = p.options![i % p.options!.length];
      else if (p.baseType === "integer") row[p.apiName] = i + 1;
      else if (p.baseType === "decimal") row[p.apiName] = Number((49.5 * (i + 1)).toFixed(2));
      else if (p.baseType === "boolean") row[p.apiName] = i % 2 === 0;
      else if (p.baseType === "date") row[p.apiName] = `2026-10-0${i + 1}`;
      else row[p.apiName] = (samples[p.apiName]?.length ? samples[p.apiName][i % samples[p.apiName].length] : `${p.displayName} ${i + 1}`).slice(0, p.maxLength ?? 200);
    }
    return row;
  });
}

export const samplePrefix = (entityId: string) => entityId.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 20);
