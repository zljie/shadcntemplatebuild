import { z } from "zod";
import { enumValues, entityLabel, fieldLabel, inferEvents, inferRoles, inferStates, type BusinessModel } from "./model";

/**
 * Business sandbox (业务沙盘推演): scenarios derived from the model — by the built-in AI or by a
 * deterministic rule-based draft — that later become blueprints for business processes. A
 * scenario only orchestrates elements that exist in the model; every reference is checked and
 * problems are reported, never silently fixed. Pure module: safe for browser, server and tests.
 */
const id = z.string().trim().min(1).max(120);
const text = (max: number) => z.string().trim().max(max);
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).catch([] as z.infer<T>[]).default([] as z.infer<T>[]);

export const scenarioStepSchema = z.object({
  actor: id,
  action: id,
  description: text(400).default(""),
  reads: list(id, 10),
  writes: list(id, 10),
  stateChange: z.object({entity: id, field: id.default("status"), from: text(60).optional(), to: text(60)}).optional().catch(undefined),
  events: list(id, 6),
  rules: list(id, 10),
});
export const scenarioSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]{1,60}$/, "场景 ID 只能包含小写字母、数字和下划线"),
  name: text(60).min(1),
  goal: text(400).default(""),
  trigger: text(300).default(""),
  actors: list(id, 8),
  preconditions: list(text(300), 8),
  steps: z.array(scenarioStepSchema).min(1).max(15),
  exceptions: list(z.object({when: text(300), handling: text(400), rules: list(id, 6)}), 8),
  outcome: text(400).default(""),
  metrics: list(id, 6),
});
export type ScenarioStep = z.infer<typeof scenarioStepSchema>;
export type ScenarioDraft = z.infer<typeof scenarioSchema>;
export type Scenario = ScenarioDraft & {
  status: "inferred" | "confirmed";
  /** Who drafted it: the model id (e.g. deepseek-flash) or "rule-based". */
  source: string;
  createdAt: string;
};
export type ScenarioIssue = {severity: "error" | "warning"; path: string; message: string};

// ── Context for the model ───────────────────────────────────────────────────
const short = (value: string, max = 90) => value.length > max ? `${value.slice(0, max)}…` : value;

/** Compact, reference-complete summary of the model: ids the AI may use, nothing it must invent. */
export function sandboxContext(model: BusinessModel): string {
  const lines: string[] = [`# 业务模型 ${model.name}`, model.description];
  lines.push("", "## 对象（entity id：名称 — 关键字段）");
  for (const e of model.entities) {
    const keys = e.fields.filter(f => enumValues(f) || e.primaryKey.includes(f.id)).map(f => { const v = enumValues(f); return v ? `${f.id}∈{${v.values.join("|")}}` : f.id; });
    lines.push(`- ${e.id}：${entityLabel(e)} — ${keys.join(", ")}；${short(e.description, 60)}`);
  }
  lines.push("", "## 关系（from.列 → to）");
  for (const r of model.relationships) lines.push(`- ${r.from}.${r.fromColumns.join(",")} → ${r.to}`);
  lines.push("", "## 操作（action id [query|command] 对象 角色：名称 — 说明）");
  for (const a of model.actions) lines.push(`- ${a.id} [${a.kind}] ${a.entity ?? "-"} ${a.roles.join("/")}：${a.name} — ${short(a.description)}`);
  lines.push("", "## 规则（rule id → 作用操作：名称 — 说明）");
  for (const r of model.rules) lines.push(`- ${r.id} → ${r.scope.actionIds.join(",") || "未指定"}：${r.name} — ${short(r.message, 60)}`);
  lines.push("", `## 角色：${inferRoles(model).map(r => r.id).join("、")}`);
  lines.push(`## 事件：${inferEvents(model).map(e => e.name).join("、") || "无"}`);
  lines.push(`## 指标：${model.metrics.map(m => m.id).join("、")}`);
  const instructions = (model.raw.semantic.ai_context as {instructions?: unknown} | undefined)?.instructions;
  if (typeof instructions === "string") lines.push("", `## 业务约定\n${instructions}`);
  return lines.join("\n");
}

export function sandboxPrompt(model: BusinessModel, options: {focus?: string; count: number; existing?: string[]}): {system: string; user: string} {
  const system = `你是业务架构师，按《业务模型设计框架 BMF-001》做业务沙盘推演：从给定业务模型推演它支撑的典型业务场景，作为后续构建业务流程的蓝本。
硬性要求：
1. 只能引用模型中已存在的 id：actor 必须是角色列表中的角色；action 必须是操作 id；reads/writes 必须是对象 id；rules 必须是规则 id；metrics 必须是指标 id；events 只能用事件列表中的名称。不得编造 id。
2. 每一步的 actor 必须在该操作的可执行角色中；操作者与目标对象要区分（例如馆员为读者借出）。
3. 场景要覆盖正常路径、拒绝与异常（exceptions），说明哪条规则导致拒绝；状态变化写在 stateChange（entity、field、from、to，取值必须来自该字段的枚举）。
4. 查询（query）不改变状态；命令（command）才写对象、改状态、产生事件。
5. 场景之间不要重复，优先覆盖不同角色和不同对象的生命周期。
只输出一个 json 对象：{"scenarios":[{"id":"snake_case","name":"中文名","goal":"","trigger":"","actors":["ROLE"],"preconditions":[""],"steps":[{"actor":"ROLE","action":"action_id","description":"","reads":["entity"],"writes":["entity"],"stateChange":{"entity":"","field":"status","from":"","to":""},"events":["EVENT"],"rules":["rule/x"]}],"exceptions":[{"when":"","handling":"","rules":["rule/x"]}],"outcome":"","metrics":["metric_id"]}]}`;
  const user = [
    sandboxContext(model), "",
    `请推演 ${options.count} 个业务场景${options.focus ? `，聚焦：${options.focus}` : "，覆盖借还、采购入库、权限与运营分析等主要业务"}。`,
    options.existing?.length ? `已有场景（不要重复）：${options.existing.join("、")}` : "",
  ].join("\n");
  return {system, user};
}

/** Parses the model reply; malformed scenarios are dropped and reported, valid ones kept. */
export function parseScenarios(value: unknown): {scenarios: ScenarioDraft[]; problems: string[]} {
  const raw = (value as {scenarios?: unknown})?.scenarios;
  if (!Array.isArray(raw)) return {scenarios: [], problems: ["回复缺少 scenarios 数组"]};
  const scenarios: ScenarioDraft[] = [], problems: string[] = [];
  raw.slice(0, 12).forEach((item, i) => {
    const parsed = scenarioSchema.safeParse(item);
    if (parsed.success) scenarios.push(parsed.data);
    else problems.push(`scenarios[${i}]: ${parsed.error.issues.slice(0, 3).map(e => `${e.path.join(".")} ${e.message}`).join("；")}`);
  });
  return {scenarios, problems};
}

// ── Validation against the model ────────────────────────────────────────────
export function validateScenario(model: BusinessModel, scenario: ScenarioDraft): ScenarioIssue[] {
  const issues: ScenarioIssue[] = [];
  const entities = new Map(model.entities.map(e => [e.id, e])), actions = new Map(model.actions.map(a => [a.id, a]));
  const rules = new Set(model.rules.map(r => r.id)), roles = new Set(inferRoles(model).map(r => r.id));
  const events = new Set(inferEvents(model).map(e => e.name)), metrics = new Set(model.metrics.map(m => m.id));
  const check = (ok: boolean, path: string, message: string, severity: ScenarioIssue["severity"] = "error") => { if (!ok) issues.push({severity, path, message}); };
  scenario.actors.forEach((r, i) => check(roles.has(r), `actors[${i}]`, `角色 ${r} 不存在`));
  scenario.metrics.forEach((m, i) => check(metrics.has(m), `metrics[${i}]`, `指标 ${m} 不存在`));
  scenario.exceptions.forEach((x, i) => x.rules.forEach((r, j) => check(rules.has(r), `exceptions[${i}].rules[${j}]`, `规则 ${r} 不存在`)));
  scenario.steps.forEach((step, i) => {
    const path = `steps[${i}]`, action = actions.get(step.action);
    check(roles.has(step.actor), `${path}.actor`, `角色 ${step.actor} 不存在`);
    if (!action) check(false, `${path}.action`, `操作 ${step.action} 不存在`);
    else {
      check(action.roles.includes(step.actor), `${path}.actor`, `${step.actor} 无权执行 ${action.id}（允许：${action.roles.join("、")}）`);
      check(action.kind === "command" || (!step.writes.length && !step.stateChange), path, `查询 ${action.id} 不应写对象或改变状态`, "warning");
    }
    [...step.reads, ...step.writes].forEach(e => check(entities.has(e), path, `对象 ${e} 不存在`));
    step.rules.forEach((r, j) => check(rules.has(r), `${path}.rules[${j}]`, `规则 ${r} 不存在`));
    step.events.forEach((e, j) => check(events.has(e), `${path}.events[${j}]`, `事件 ${e} 不在模型推断的事件中`, "warning"));
    if (step.stateChange) {
      const entity = entities.get(step.stateChange.entity), field = entity?.fields.find(f => f.id === step.stateChange!.field);
      const values = field && enumValues(field)?.values;
      if (!entity) check(false, `${path}.stateChange.entity`, `对象 ${step.stateChange.entity} 不存在`);
      else if (!field) check(false, `${path}.stateChange.field`, `字段 ${step.stateChange.entity}.${step.stateChange.field} 不存在`);
      else if (values) for (const key of ["from", "to"] as const) {
        const value = step.stateChange[key];
        if (value) check(values.includes(value), `${path}.stateChange.${key}`, `状态值 ${value} 不在 ${entity.id}.${field.id} 的取值中`);
      }
    }
  });
  return issues;
}

/** Commands no scenario exercises yet — what the sandbox has not covered. */
export function uncoveredCommands(model: BusinessModel, scenarios: ScenarioDraft[]): string[] {
  const used = new Set(scenarios.flatMap(s => s.steps.map(step => step.action)));
  return model.actions.filter(a => a.kind === "command" && !used.has(a.id)).map(a => a.id);
}

// ── Rule-based draft (offline / mock provider) ──────────────────────────────
/**
 * Deterministic draft used when no AI provider is configured: one lifecycle scenario per entity
 * that has commands — look it up, then run its commands in source order with their allowed role.
 * It is a starting point for review, not an inference of business intent.
 */
export function ruleBasedScenarios(model: BusinessModel, count: number): ScenarioDraft[] {
  const states = new Map(inferStates(model).map(s => [s.entity, s]));
  const events = inferEvents(model);
  return model.entities.flatMap((entity): ScenarioDraft[] => {
    const commands = model.actions.filter(a => a.kind === "command" && a.entity === entity.id);
    if (!commands.length) return [];
    const query = model.actions.find(a => a.kind === "query" && a.entity === entity.id && a.roles.length);
    const state = states.get(entity.id);
    const steps: ScenarioStep[] = [];
    if (query) steps.push({actor: query.roles[0], action: query.id, description: query.name, reads: [entity.id], writes: [], events: [], rules: model.rules.filter(r => r.scope.actionIds.includes(query.id)).map(r => r.id)});
    commands.slice(0, 6).forEach(command => {
      const produced = events.filter(e => e.producedBy.includes(command.id)).map(e => e.name);
      steps.push({
        actor: command.roles[0] ?? "", action: command.id, description: command.name, reads: [], writes: [entity.id, ...(produced.length ? [events[0].entity] : [])],
        events: produced, rules: model.rules.filter(r => r.scope.actionIds.includes(command.id)).map(r => r.id),
      });
    });
    const label = entityLabel(entity);
    return [{
      id: `${entity.id}_lifecycle`.slice(0, 60), name: `${label}生命周期`.slice(0, 60), goal: `按模型中的操作管理${label}从创建到结束的过程`,
      trigger: `需要处理${label}`, actors: [...new Set(steps.map(s => s.actor).filter(Boolean))], preconditions: [],
      steps, exceptions: [], outcome: state ? `${label}的 ${fieldLabel(entity.fields.find(f => f.id === state.field)!)} 在 ${state.values.join(" / ")} 间变化` : "",
      metrics: model.metrics.filter(m => m.expression.includes(`${entity.id}.`)).map(m => m.id).slice(0, 3),
    }];
  }).slice(0, count);
}
