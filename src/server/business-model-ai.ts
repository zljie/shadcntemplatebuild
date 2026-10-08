import { extractJson } from "../ai/page-agent";
import { getProvider } from "../llm/registry";
import type { LLMProvider } from "../llm/types";
import { objectTypeName, toObjectType, type BusinessModel } from "../business-model/model";
import { parseScenarios, ruleBasedScenarios, sandboxContext, sandboxPrompt, type Scenario, type ScenarioDraft } from "../business-model/sandbox";
import { appDesignPlanSchema, appDesignPrompt, applyModule, checkPlan, ruleBasedPlan, samplePrefix, sampleRows, type AppDesign, type AppDesignPlan, type PlanIssue } from "../business-model/app-design";
import { getBusinessModel, saveBusinessModel, type StoredBusinessModel } from "./business-model-store";
import { db, generatePages, getObjectType, importObjects, runtimeConfig, saveObjectType } from "./ontology-store";
import { transaction } from "./db";

/**
 * Built-in AI for business modelling: sandbox scenario inference and one-click app design.
 * Uses the configured LLM provider; when none is configured (or LLM_PROVIDER=mock) both fall
 * back to deterministic rule-based drafts and say so in `source`.
 */
type Fail = {ok: false; status: number; message: string; problems?: string[]};
const now = () => new Date().toISOString();

function provider(override?: LLMProvider | null): LLMProvider | null {
  if (override !== undefined) return override;
  try { const p = getProvider(); return p.id === "mock" ? null : p; } catch { return null; }
}

async function askJson(llm: LLMProvider, system: string, user: string, signal?: AbortSignal): Promise<unknown> {
  const result = await llm.chat({messages: [{role: "system", content: system}, {role: "user", content: user}], json: true, temperature: 0.3, maxTokens: 12_000, signal});
  return extractJson(result.text);
}

// ── Sandbox ─────────────────────────────────────────────────────────────────
export type SandboxResult = {ok: true; added: Scenario[]; source: string; problems: string[]; model: StoredBusinessModel} | Fail;

export async function runSandbox(id: string, options: {focus?: string; count?: number; llm?: LLMProvider | null; signal?: AbortSignal} = {}): Promise<SandboxResult> {
  const stored = getBusinessModel(id);
  if (!stored) return {ok: false, status: 404, message: "业务模型不存在"};
  const model = stored.model, count = Math.min(Math.max(options.count ?? 5, 1), 10), existing = model.scenarios ?? [];
  const llm = provider(options.llm);
  let drafts: ScenarioDraft[], problems: string[] = [], source: string;
  if (!llm) {
    source = "rule-based";
    drafts = ruleBasedScenarios(model, count + existing.length).filter(d => !existing.some(s => s.id === d.id)).slice(0, count);
  } else {
    source = llm.model;
    const {system, user} = sandboxPrompt(model, {focus: options.focus, count, existing: existing.map(s => `${s.id}（${s.name}）`)});
    try {
      let parsed = parseScenarios(await askJson(llm, system, user, options.signal));
      if (!parsed.scenarios.length) {
        // One repair round: feed the schema problems back.
        parsed = parseScenarios(await askJson(llm, system, `${user}\n\n上一次回复无法使用：${parsed.problems.join("；")}。请严格按 json 结构重新输出。`, options.signal));
      }
      ({scenarios: drafts, problems} = parsed);
    } catch (error) {
      return {ok: false, status: 502, message: `AI 推演失败：${error instanceof Error ? error.message : String(error)}`};
    }
    if (!drafts.length) return {ok: false, status: 502, message: "AI 没有返回可用的场景", problems};
  }
  const taken = new Set(existing.map(s => s.id)), time = now();
  const added: Scenario[] = drafts.map(draft => {
    let unique = draft.id;
    for (let i = 2; taken.has(unique); i++) unique = `${draft.id}_${i}`;
    taken.add(unique);
    return {...draft, id: unique, status: "inferred", source, createdAt: time};
  });
  const next: BusinessModel = {...model, scenarios: [...existing, ...added]};
  return {ok: true, added, source, problems, model: saveBusinessModel(id, next)};
}

// ── App design ──────────────────────────────────────────────────────────────
export type AppDesignResult = {ok: true; design: AppDesign; model: StoredBusinessModel} | Fail;

/** Orders modules so link targets come first (cycles keep source order). */
function dependencyOrder(model: BusinessModel, entities: string[]): string[] {
  const set = new Set(entities), out: string[] = [], visiting = new Set<string>();
  const visit = (e: string) => {
    if (out.includes(e) || visiting.has(e)) return;
    visiting.add(e);
    for (const r of model.relationships) if (r.from === e && r.to !== e && set.has(r.to)) visit(r.to);
    visiting.delete(e); out.push(e);
  };
  entities.forEach(visit);
  return out;
}

export async function runAppDesign(id: string, options: {llm?: LLMProvider | null; signal?: AbortSignal} = {}): Promise<AppDesignResult> {
  const stored = getBusinessModel(id);
  if (!stored) return {ok: false, status: 404, message: "业务模型不存在"};
  const model = stored.model, llm = provider(options.llm);
  let plan: AppDesignPlan, source: string;
  if (!llm) { plan = ruleBasedPlan(model); source = "rule-based"; }
  else {
    source = llm.model;
    const scenarios = (model.scenarios ?? []).filter(s => s.status === "confirmed").concat((model.scenarios ?? []).filter(s => s.status !== "confirmed")).slice(0, 10);
    const {system, user} = appDesignPrompt(model, sandboxContext(model), scenarios);
    try {
      let parsed = appDesignPlanSchema.safeParse(await askJson(llm, system, user, options.signal));
      if (!parsed.success) parsed = appDesignPlanSchema.safeParse(await askJson(llm, system, `${user}\n\n上一次回复不符合结构：${parsed.error.issues.slice(0, 5).map(e => `${e.path.join(".")} ${e.message}`).join("；")}。请严格按 json 结构重新输出。`, options.signal));
      if (!parsed.success) return {ok: false, status: 502, message: "AI 返回的应用设计方案不符合结构", problems: parsed.error.issues.slice(0, 5).map(e => `${e.path.join(".")} ${e.message}`)};
      plan = parsed.data;
    } catch (error) {
      return {ok: false, status: 502, message: `AI 应用设计失败：${error instanceof Error ? error.message : String(error)}`};
    }
  }
  const checked = checkPlan(model, plan), issues: PlanIssue[] = [...checked.issues];
  plan = checked.plan;
  const modules = new Map(plan.modules.map(m => [m.entity, m]));
  const order = dependencyOrder(model, plan.modules.map(m => m.entity));
  const bindings = {...model.bindings}, types: Record<string, string> = {};
  const usable = order.filter(entity => {
    const apiName = objectTypeName(model, entity), existing = getObjectType(apiName);
    if (existing && bindings[entity]?.objectType !== apiName) { issues.push({severity: "error", path: `modules.${entity}`, message: `数据模型 ${apiName} 已存在且不属于该业务对象，已跳过`}); return false; }
    return true;
  });

  // Pass 1 creates every type without links; pass 2 adds links now that all targets exist.
  const database = db();
  for (const pass of [1, 2] as const) {
    for (const entity of usable) {
      const converted = toObjectType(model, entity, pass === 1 ? {} : types);
      if (!converted.ok) { if (pass === 1) issues.push({severity: "error", path: `modules.${entity}`, message: converted.message}); continue; }
      const saved = transaction(database, () => saveObjectType(applyModule(converted.type, modules.get(entity)!), database));
      if (!saved.ok) { if (pass === 1) issues.push({severity: "error", path: `modules.${entity}`, message: saved.errors.map(e => `${e.path} ${e.message}`).join("；")}); continue; }
      types[entity] = saved.value.apiName;
    }
  }
  const prefixes = Object.fromEntries(Object.entries(types).map(([entity, apiName]) => [apiName, samplePrefix(entity)]));
  const result: AppDesign["modules"] = [];
  for (const entity of usable) {
    const apiName = types[entity];
    if (!apiName) continue;
    const type = getObjectType(apiName)!;
    if (!runtimeConfig(apiName)!.rows.length) importObjects(apiName, sampleRows(type, samplePrefix(entity), prefixes, modules.get(entity)!.samples));
    const pages = generatePages(apiName, undefined, {source: "business-model"});
    if (!pages.ok) { issues.push({severity: "error", path: `modules.${entity}`, message: pages.errors.map(e => e.message).join("；")}); continue; }
    bindings[entity] = {objectType: apiName, boundAt: bindings[entity]?.boundAt ?? now()};
    result.push({entity, objectType: apiName, pages: pages.value.length, records: runtimeConfig(apiName)!.rows.length});
  }
  const design: AppDesign = {plan, source, generatedAt: now(), issues, modules: result};
  return {ok: true, design, model: saveBusinessModel(id, {...model, bindings, appDesign: design})};
}

