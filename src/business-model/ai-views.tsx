"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, Bot, CheckCircle2, Flag, Loader2, PencilRuler, Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { StoredBusinessModel } from "@/server/business-model-store";
import { entityLabel, type BusinessModel, type ModelPatch } from "./model";
import { uncoveredCommands, validateScenario, type Scenario } from "./sandbox";

export type AiStatus = {provider: string; label: string; model: string; configured: boolean};
type Notify = (tone: "ok" | "error", text: string) => void;

async function post(url: string, body: unknown) {
  const response = await fetch(url, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error([result.error ?? `请求失败（${response.status}）`, ...(result.problems ?? [])].join("；"));
  return result;
}
const usesAi = (ai: AiStatus) => ai.configured && ai.provider !== "mock";

/** Seconds since `running` became true; drives the progress label of long AI calls. */
function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const started = Date.now(), timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => { clearInterval(timer); setElapsed(0); };
  }, [running]);
  return elapsed;
}

function AiBadge({ai}: {ai: AiStatus}) {
  return usesAi(ai) ? <span className="bm-ai-badge"><Bot size={12}/>{ai.label} · {ai.model}</span>
    : <span className="bm-ai-badge off" title="在 .env.local 配置 LLM_PROVIDER 与 API Key 后使用 AI"><Bot size={12}/>未配置 AI，使用规则生成</span>;
}

// ── 业务沙盘推演 ─────────────────────────────────────────────────────────────
export function SandboxView({data, ai, onModel, notify, onPatch}: {
  data: StoredBusinessModel; ai: AiStatus; onModel: (stored: StoredBusinessModel) => void; notify: Notify;
  onPatch: (patches: ModelPatch[], success: string) => Promise<boolean>;
}) {
  const model = data.model, scenarios = useMemo(() => model.scenarios ?? [], [model.scenarios]);
  const [focus, setFocus] = useState(""), [count, setCount] = useState(5), [running, setRunning] = useState(false);
  const elapsed = useElapsed(running);
  const commands = model.actions.filter(a => a.kind === "command").length;
  const uncovered = useMemo(() => uncoveredCommands(model, scenarios), [model, scenarios]);

  async function infer() {
    setRunning(true);
    try {
      const result = await post(`/api/business-models/${encodeURIComponent(data.id)}/sandbox`, {focus, count});
      onModel(result.model);
      notify("ok", `${result.source === "rule-based" ? "规则生成" : `AI（${result.source}）推演`}了 ${result.added.length} 个场景${result.problems.length ? `，${result.problems.length} 个回复片段无法使用` : ""}`);
    } catch (error) { notify("error", `推演失败：${error instanceof Error ? error.message : "请重试"}`); }
    finally { setRunning(false); }
  }

  return <div className="bm-stack">
    <section className="bm-section bm-ai-panel">
      <div className="bm-ai-head"><div><h2><Sparkles size={15}/>业务沙盘推演</h2>
        <p className="bm-footnote">根据本体模型推演它支撑的业务场景：谁触发、按什么顺序执行哪些操作、读写哪些对象、引起什么状态变化与事件、受哪些规则约束、何时被拒绝。推演结果标记为「推断」，确认后作为后续构建业务流程的蓝本。</p></div>
        <AiBadge ai={ai}/></div>
      <div className="bm-ai-form">
        <label className="model-field bm-grow">推演重点（可选）<input value={focus} maxLength={200} placeholder="例如：借还与逾期处置；采购从申请到入库" onChange={e => setFocus(e.target.value)}/></label>
        <label className="model-field">场景数量<select value={count} onChange={e => setCount(Number(e.target.value))}>{[3, 5, 8].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <Button disabled={running} onClick={() => void infer()}>{running ? <><Loader2 size={14} className="bm-spin"/>推演中… {elapsed}s</> : <><Wand2 size={14}/>{usesAi(ai) ? "AI 推演场景" : "生成场景草稿"}</>}</Button>
      </div>
      <div className="bm-coverage">
        <span><b data-testid="scenario-count">{scenarios.length}</b> 个场景</span>
        <span><b>{scenarios.filter(s => s.status === "confirmed").length}</b> 个已确认为流程蓝本</span>
        <span><b>{commands - uncovered.length}</b> / {commands} 个命令已被场景覆盖</span>
        {uncovered.length > 0 && <details><summary>未覆盖的命令（{uncovered.length}）</summary><p>{uncovered.join("、")}</p></details>}
      </div>
    </section>
    {scenarios.length ? scenarios.map(s => <ScenarioCard key={s.id} scenario={s} model={model} onPatch={onPatch}/>)
      : <div className="table-empty"><Sparkles size={22}/><span>还没有场景。点击「{usesAi(ai) ? "AI 推演场景" : "生成场景草稿"}」开始推演。</span></div>}
  </div>;
}

function ScenarioCard({scenario, model, onPatch}: {scenario: Scenario; model: BusinessModel; onPatch: ModelPatchFn}) {
  const issues = useMemo(() => validateScenario(model, scenario), [model, scenario]);
  const actions = new Map(model.actions.map(a => [a.id, a])), entities = new Map(model.entities.map(e => [e.id, e]));
  const rules = new Map(model.rules.map(r => [r.id, r.name]));
  const entityChip = (id: string) => <code key={id} title={id}>{entities.get(id) ? entityLabel(entities.get(id)!) : id}</code>;
  const confirmed = scenario.status === "confirmed";
  return <article className={`bm-scenario${confirmed ? " confirmed" : ""}`} data-scenario={scenario.id}>
    <header>
      <div><h3>{scenario.name}</h3><code>{scenario.id}</code>
        {confirmed ? <Badge className="bm-confirmed"><CheckCircle2 size={11}/>流程蓝本</Badge> : <Badge variant="outline" className="bm-inferred">推断</Badge>}
        <span className="bm-source">{scenario.source === "rule-based" ? "规则生成" : scenario.source}</span></div>
      <div className="bm-actions">
        <Button size="sm" variant={confirmed ? "ghost" : "default"} onClick={() => void onPatch([{kind: "scenario", id: scenario.id, status: confirmed ? "inferred" : "confirmed"}], confirmed ? `已取消确认「${scenario.name}」` : `已将「${scenario.name}」确认为流程蓝本`)}>
          {confirmed ? <><Undo2 size={13}/>取消确认</> : <><Flag size={13}/>确认为流程蓝本</>}</Button>
        <Button size="sm" variant="ghost" className="danger" aria-label={`删除场景 ${scenario.name}`} onClick={() => void onPatch([{kind: "removeScenario", id: scenario.id}], `已删除场景「${scenario.name}」`)}><Trash2 size={13}/></Button>
      </div>
    </header>
    {scenario.goal && <p className="bm-scenario-goal">{scenario.goal}</p>}
    <dl className="bm-scenario-meta">
      <dt>触发</dt><dd>{scenario.trigger || "—"}</dd>
      <dt>参与角色</dt><dd>{scenario.actors.map(r => <span key={r} className="type-badge catalog-tag">{r}</span>)}</dd>
      {scenario.preconditions.length > 0 && <><dt>前置条件</dt><dd><ul>{scenario.preconditions.map((p, i) => <li key={i}>{p}</li>)}</ul></dd></>}
    </dl>
    <ol className="bm-steps">{scenario.steps.map((step, i) => { const action = actions.get(step.action); return <li key={i}>
      <div className="bm-step-head"><span className="type-badge">{step.actor}</span><ArrowRight size={12}/>
        <strong>{action?.name ?? step.action}</strong>{action && <span className={`bm-kind ${action.kind}`}>{action.kind === "query" ? "查询" : "命令"}</span>}<code>{step.action}</code></div>
      {step.description && <p>{step.description}</p>}
      <div className="bm-step-tags">
        {step.reads.length > 0 && <span>读 {step.reads.map(entityChip)}</span>}
        {step.writes.length > 0 && <span>写 {step.writes.map(entityChip)}</span>}
        {step.stateChange && <span className="bm-state-change">{step.stateChange.entity}.{step.stateChange.field} <code>{step.stateChange.from || "∅"}</code><ArrowRight size={11}/><code>{step.stateChange.to}</code></span>}
        {step.events.map(e => <span key={e} className="bm-event">事件 {e}</span>)}
        {step.rules.map(r => <span key={r} className="bm-rule" title={r}>{rules.get(r) ?? r}</span>)}
      </div>
    </li>; })}</ol>
    {scenario.exceptions.length > 0 && <div className="bm-exceptions"><h4>拒绝与异常</h4><ul>{scenario.exceptions.map((x, i) => <li key={i}><b>{x.when}</b>：{x.handling}{x.rules.map(r => <span key={r} className="bm-rule" title={r}>{rules.get(r) ?? r}</span>)}</li>)}</ul></div>}
    <footer>{scenario.outcome && <span>结果：{scenario.outcome}</span>}{scenario.metrics.length > 0 && <span>观察指标：{scenario.metrics.join("、")}</span>}</footer>
    {issues.length > 0 && <ul className="bm-issue-list bm-scenario-issues">{issues.map((issue, i) => <li key={i}><AlertTriangle size={12}/><span>{issue.message}<code>{issue.path}</code></span></li>)}</ul>}
  </article>;
}
type ModelPatchFn = (patches: ModelPatch[], success: string) => Promise<boolean>;

// ── 应用设计（一键转换） ──────────────────────────────────────────────────────
export function AppDesignView({data, ai, onModel, notify}: {data: StoredBusinessModel; ai: AiStatus; onModel: (stored: StoredBusinessModel) => void; notify: Notify}) {
  const [running, setRunning] = useState(false), elapsed = useElapsed(running);
  const design = data.model.appDesign, model = data.model;
  const modules = new Map((design?.plan.modules ?? []).map(m => [m.entity, m]));

  async function convert() {
    setRunning(true);
    try {
      const result = await post(`/api/business-models/${encodeURIComponent(data.id)}/app-design`, {});
      onModel(result.model);
      const pages = result.design.modules.reduce((sum: number, m: {pages: number}) => sum + m.pages, 0);
      notify("ok", `已生成 ${result.design.modules.length} 个模块、${pages} 个页面${result.design.issues.length ? `，${result.design.issues.length} 项需关注` : ""}`);
    } catch (error) { notify("error", `转换失败：${error instanceof Error ? error.message : "请重试"}`); }
    finally { setRunning(false); }
  }

  return <div className="bm-stack">
    <section className="bm-section bm-ai-panel">
      <div className="bm-ai-head"><div><h2><PencilRuler size={15}/>一键转换为应用设计</h2>
        <p className="bm-footnote">{usesAi(ai) ? "AI" : "规则"}根据对象、关系、行为与沙盘场景给出应用设计方案（模块、名称、标题字段、列表列、字段标签），方案经模型校验后沿用现有生成路径，为每个模块生成数据模型、示例记录以及「列表 + 详情」「独立详情」「新建 / 编辑」页面，模块之间按关系建立关联。已在页面设计器中修改过的页面不会被覆盖。</p></div>
        <AiBadge ai={ai}/></div>
      <div className="bm-ai-form"><Button disabled={running} onClick={() => void convert()}>{running ? <><Loader2 size={14} className="bm-spin"/>生成中… {elapsed}s</> : <><Wand2 size={14}/>{usesAi(ai) ? "AI 一键生成应用" : "按规则生成应用"}</>}</Button>
        {design && <span className="bm-footnote">上次生成：{design.generatedAt.slice(0, 16).replace("T", " ")} · {design.source === "rule-based" ? "规则生成" : design.source}</span>}</div>
    </section>
    {design ? <>
      <section className="bm-section"><h2>{design.plan.appName}</h2><p className="bm-footnote">{design.plan.summary}</p>
        <div className="bm-coverage"><span><b data-testid="design-modules">{design.modules.length}</b> 个模块</span><span><b>{design.modules.reduce((s, m) => s + m.pages, 0)}</b> 个页面</span>
          <span><b>{design.modules.reduce((s, m) => s + m.records, 0)}</b> 条示例记录</span><span><b>{design.plan.skipped.length}</b> 个对象未生成模块</span></div></section>
      <div className="table-card"><div className="table-scroll"><table className="bm-wrap"><caption className="sr-only">应用模块</caption>
        <thead><tr><th>模块</th><th>业务对象</th><th>列表列</th><th>支撑场景</th><th>设计理由</th><th>页面资源</th></tr></thead>
        <tbody>{design.modules.map(m => { const plan = modules.get(m.entity), entity = model.entities.find(e => e.id === m.entity);
          return <tr key={m.entity}><td><div className="resource-name"><div><strong>{plan?.pluralDisplayName ?? plan?.displayName}</strong><p>{m.objectType}</p></div></div></td>
            <td>{entity ? entityLabel(entity) : m.entity}<small className="bm-footnote">{m.entity}</small></td>
            <td>{plan?.listFields.map(f => <code key={f} className="bm-chip">{plan.fieldLabels[f] ?? f}</code>)}</td>
            <td>{plan?.scenarios.length ? plan.scenarios.join("、") : "—"}</td><td>{plan?.reason}</td>
            <td><div className="catalog-row-actions bm-left">
              <Button asChild size="sm" variant="outline"><a href={`/apps/${m.objectType}`}>打开<ArrowUpRight size={12}/></a></Button>
              <Button asChild size="sm" variant="ghost"><a href={`/editor?page=${encodeURIComponent(`${m.objectType}-list-detail`)}`}>设计器</a></Button>
              <small className="bm-footnote">{m.pages} 页 · {m.records} 条</small></div></td></tr>; })}</tbody></table></div></div>
      {design.plan.skipped.length > 0 && <section className="bm-section muted"><h2>未生成模块的对象</h2><ul className="bm-mini">{design.plan.skipped.map(s => <li key={s.entity}><code>{s.entity}</code> {s.reason}</li>)}</ul></section>}
      {design.issues.length > 0 && <section className="bm-section"><h2>方案校验</h2><ul className="bm-issue-list">{design.issues.map((issue, i) => <li key={i}><Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity === "error" ? "错误" : "提醒"}</Badge><span>{issue.message}<code>{issue.path}</code></span></li>)}</ul></section>}
      <p className="bm-footnote">生成的数据模型与页面同时出现在「资源清单」和「业务原型」中，可继续在页面设计器中调整。</p>
    </> : <div className="table-empty"><PencilRuler size={22}/><span>尚未生成应用设计。</span></div>}
  </div>;
}
