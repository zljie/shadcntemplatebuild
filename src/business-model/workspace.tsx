"use client";
import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowUpRight, CheckCircle2, Clock, Download, Info, KeyRound, Network, RotateCcw, Save, Search, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TopNav } from "@/prototype/top-nav";
import type { StoredBusinessModel } from "@/server/business-model-store";
import {
  completeness, entityLabel, enumCandidate, fieldLabel, fieldTypeLabels, inferEvents, inferRoles, inferStates, viewLabels,
  type BmAction, type BmEntity, type BusinessModel, type FieldConstraints, type FieldType, type JsonSchema, type ModelIssue, type ModelPatch, type View,
} from "./model";

const tabs = ["overview", "entities", "relationships", "actions", "rules", "roles", "metrics", "lifecycle", "issues"] as const;
type Tab = typeof tabs[number];
type Props = {stored: StoredBusinessModel; initialTab?: string; initialEntity?: string};

async function request(url: string, method: string, body: unknown) {
  const response = await fetch(url, {method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `请求失败（${response.status}）`);
  return result;
}

export function BusinessModelWorkspace({stored, initialTab, initialEntity}: Props) {
  const [data, setData] = useState(stored);
  const [tab, setTabState] = useState<Tab>(tabs.includes(initialTab as Tab) ? initialTab as Tab : "overview");
  const [entityId, setEntityState] = useState(stored.model.entities.some(e => e.id === initialEntity) ? initialEntity! : stored.model.entities[0]?.id ?? "");
  const [notice, setNotice] = useState<{tone: "ok" | "error"; text: string} | null>(null), [busy, setBusy] = useState(false);
  const model = data.model, issues = data.issues;
  const derived = useMemo(() => ({roles: inferRoles(model), states: inferStates(model), events: inferEvents(model)}), [model]);
  const base = `/api/business-models/${encodeURIComponent(data.id)}`;

  const sync = (next: {tab?: Tab; entity?: string}) => {
    const url = new URL(window.location.href);
    if (next.tab) url.searchParams.set("tab", next.tab);
    if (next.entity) url.searchParams.set("entity", next.entity);
    window.history.replaceState(null, "", url);
  };
  const setTab = (value: Tab) => { setTabState(value); sync({tab: value}); };
  const openEntity = (id: string) => { setEntityState(id); setTabState("entities"); sync({tab: "entities", entity: id}); };

  async function save(patches: ModelPatch[], success: string): Promise<boolean> {
    setBusy(true); setNotice(null);
    try { setData(await request(base, "PATCH", {patches})); setNotice({tone: "ok", text: success}); return true; }
    catch (error) { setNotice({tone: "error", text: `保存失败：${error instanceof Error ? error.message : "请重试"}`}); return false; }
    finally { setBusy(false); }
  }
  async function createPages(entity: string): Promise<void> {
    setBusy(true); setNotice(null);
    try {
      const result = await request(`${base}/pages`, "POST", {entity});
      const fresh = await fetch(base).then(r => r.json());
      setData(fresh);
      setNotice({tone: "ok", text: `已生成数据模型 ${result.objectType} 及 ${result.pages.length} 个页面${result.skipped.length ? `（跳过字段：${result.skipped.join("、")}）` : ""}`});
    } catch (error) { setNotice({tone: "error", text: `生成失败：${error instanceof Error ? error.message : "请重试"}`}); }
    finally { setBusy(false); }
  }

  const counts = data.counts, errors = issues.filter(i => i.severity === "error").length;
  const entity = model.entities.find(e => e.id === entityId);
  return <div className="catalog-app">
    <TopNav active="/business-models"/>
    <main className="catalog-main bm-main">
      <Link className="record-back" href="/business-models"><ArrowLeft size={13}/>业务模型列表</Link>
      <section className="catalog-hero">
        <div><span className="page-eyebrow"><Network size={14}/> {model.namespace ?? model.name} · 来源版本 {model.sourceVersion || "未声明"}</span><h1>{model.name}</h1>
          <p>{model.description}</p>
          <div className="bm-hero-meta">
            <code>{data.fileName}</code>
            {typeof model.metadata.implementation_status === "string" && <Badge variant="outline">{model.metadata.implementation_status}</Badge>}
            <Badge variant={errors ? "destructive" : "secondary"}>{errors ? `${errors} 个错误` : "引用校验通过"}</Badge>
          </div></div>
        <div className="catalog-hero-actions"><Button asChild variant="outline"><a href={`${base}/export`}><Download size={14}/>导出 YAML</a></Button></div>
      </section>
      <p className={`catalog-notice${notice?.tone === "error" ? " danger" : ""}`} role="status">{busy ? "处理中…" : notice?.text}</p>

      <Tabs value={tab} onValueChange={value => setTab(value as Tab)} className="catalog-tabs">
        <div className="catalog-toolbar"><TabsList className="bm-tabs">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="entities">对象 {counts.entity}</TabsTrigger>
          <TabsTrigger value="relationships">关系 {counts.relationship}</TabsTrigger>
          <TabsTrigger value="actions">行为 {counts.action}</TabsTrigger>
          <TabsTrigger value="rules">规则 {counts.rule}</TabsTrigger>
          <TabsTrigger value="roles">角色 {counts.role}</TabsTrigger>
          <TabsTrigger value="metrics">指标 {counts.metric}</TabsTrigger>
          <TabsTrigger value="lifecycle">状态与事件</TabsTrigger>
          <TabsTrigger value="issues">问题 {issues.length}</TabsTrigger>
        </TabsList></div>

        <TabsContent value="overview"><Overview data={data} onOpen={setTab}/></TabsContent>
        <TabsContent value="entities">
          <div className="bm-split">
            <nav className="bm-entity-list" aria-label="业务对象">{model.entities.map(e => {
              const c = completeness(model, "entity", e.id, issues);
              return <button type="button" key={e.id} className={e.id === entityId ? "active" : undefined} aria-current={e.id === entityId ? "true" : undefined} onClick={() => openEntity(e.id)}>
                <span><strong>{entityLabel(e)}</strong><code>{e.id}</code></span>
                <small>{e.fields.length}{c.bound && <CheckCircle2 size={11} aria-label="已绑定"/>}{c.validation === "blocked" && <AlertTriangle size={11} aria-label="有阻塞问题"/>}</small>
              </button>;
            })}</nav>
            {entity ? <EntityPanel key={`${entity.id}:${data.updatedAt}`} entity={entity} model={model} issues={issues} busy={busy} onSave={save} onCreatePages={createPages} onOpenEntity={openEntity}/>
              : <Empty text="没有业务对象"/>}
          </div>
        </TabsContent>
        <TabsContent value="relationships"><Relationships model={model} issues={issues} onOpenEntity={openEntity}/></TabsContent>
        <TabsContent value="actions"><Actions model={model} issues={issues}/></TabsContent>
        <TabsContent value="rules"><Rules model={model} issues={issues}/></TabsContent>
        <TabsContent value="roles"><Roles model={model} roles={derived.roles}/></TabsContent>
        <TabsContent value="metrics"><Metrics model={model} issues={issues}/></TabsContent>
        <TabsContent value="lifecycle"><Lifecycle model={model} states={derived.states} events={derived.events} onOpenEntity={openEntity}/></TabsContent>
        <TabsContent value="issues"><Issues issues={issues}/></TabsContent>
      </Tabs>
    </main>
  </div>;
}

// ── Overview ────────────────────────────────────────────────────────────────
const viewTab: Partial<Record<View, Tab>> = {entity: "entities", relationship: "relationships", action: "actions", rule: "rules", role: "roles", metric: "metrics", state: "lifecycle", event: "lifecycle"};
const viewHints: Record<View, string> = {
  entity: "有身份、可追踪的事物", relationship: "对象之间的关联", action: "查询与命令", rule: "策略与约束", role: "由 allowed_roles 推断",
  state: "由 status 字段推断", event: "由 *_event 推断", metric: "分析口径", process: "源文件未定义", document: "源文件未定义",
};
function Overview({data, onOpen}: {data: StoredBusinessModel; onOpen: (tab: Tab) => void}) {
  const {model, issues, counts} = data;
  const authored: View[] = ["entity", "relationship", "action", "rule", "metric"];
  const instructions = (model.raw.semantic.ai_context as {instructions?: unknown} | undefined)?.instructions;
  return <div className="bm-overview">
    <div className="bm-view-grid">{(["entity", "relationship", "action", "rule", "role", "state", "event", "metric", "process", "document"] as View[]).map(view => {
      const target = viewTab[view], inferred = ["role", "state", "event"].includes(view);
      const body = <><span className="bm-view-label">{viewLabels[view]}{inferred && <Badge variant="outline" className="bm-inferred">推断</Badge>}</span>
        <b data-testid={`count-${view}`}>{counts[view]}</b>
        <small>{view === "action" ? `${counts.queries} 查询 · ${counts.commands} 命令` : view === "entity" ? `${counts.fields} 个字段` : viewHints[view]}</small></>;
      return target ? <button type="button" key={view} className="bm-view-card" onClick={() => onOpen(target)}>{body}</button> : <div key={view} className="bm-view-card muted">{body}</div>;
    })}</div>

    <section className="bm-section"><h2>完成度（BMF §8.3）</h2>
      <div className="table-card"><table><thead><tr><th>视角</th><th>元素</th><th>已定义</th><th>已校验</th><th>已绑定</th><th>已验证</th></tr></thead>
        <tbody>{authored.map(view => {
          const ids = (view === "entity" ? model.entities : view === "relationship" ? model.relationships : view === "action" ? model.actions : view === "rule" ? model.rules : model.metrics).map(x => x.id);
          const states = ids.map(id => completeness(model, view, id, issues));
          return <tr key={view}><td>{viewLabels[view]}</td><td>{ids.length}</td><td>{states.filter(s => s.defined).length}</td>
            <td>{states.filter(s => s.validation === "validated").length}</td><td>{view === "entity" ? states.filter(s => s.bound).length : "—"}</td><td>0</td></tr>;
        })}</tbody></table></div>
      <p className="bm-footnote">「已校验」指结构与引用检查无错误；「已绑定」指业务对象已投影为应用数据模型；运行验证尚未接入，全部为未验证。角色、状态、事件为推断候选，需业务责任人确认。</p>
    </section>

    <div className="bm-two">
      <section className="bm-section"><h2>问题清单</h2>
        {issues.length ? <ul className="bm-issue-list">{issues.slice(0, 6).map((issue, i) => <IssueLine key={i} issue={issue}/>)}</ul> : <p className="bm-footnote">没有发现问题。</p>}
        {issues.length > 6 && <Button size="sm" variant="ghost" onClick={() => onOpen("issues")}>查看全部 {issues.length} 项</Button>}
      </section>
      <section className="bm-section"><h2>来源说明</h2>
        <dl className="bm-meta">{Object.entries(model.metadata).map(([key, value]) => <Fragment key={key}><dt>{key}</dt><dd>{String(value)}</dd></Fragment>)}</dl>
        {typeof instructions === "string" && <p className="bm-footnote">{instructions}</p>}
      </section>
    </div>
  </div>;
}

// ── Entities ────────────────────────────────────────────────────────────────
type FieldDraft = {displayName: string; description: string; constraints: FieldConstraints};
function draftOf(entity: BmEntity) {
  return {displayName: entity.displayName ?? "", description: entity.description,
    fields: Object.fromEntries(entity.fields.map(f => [f.id, {displayName: f.displayName ?? "", description: f.description, constraints: f.constraints}])) as Record<string, FieldDraft>};
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function EntityPanel({entity, model, issues, busy, onSave, onCreatePages, onOpenEntity}: {
  entity: BmEntity; model: BusinessModel; issues: ModelIssue[]; busy: boolean;
  onSave: (patches: ModelPatch[], success: string) => Promise<boolean>; onCreatePages: (entity: string) => Promise<void>; onOpenEntity: (id: string) => void;
}) {
  const original = useMemo(() => draftOf(entity), [entity]);
  const [draft, setDraft] = useState(original);
  const patches = useMemo(() => {
    const out: ModelPatch[] = [];
    if (draft.displayName !== original.displayName || draft.description !== original.description)
      out.push({kind: "entity", id: entity.id, ...(draft.displayName !== original.displayName ? {displayName: draft.displayName.trim() || null} : {}), ...(draft.description !== original.description ? {description: draft.description} : {})});
    for (const field of entity.fields) {
      const now = draft.fields[field.id], was = original.fields[field.id];
      if (same(now, was)) continue;
      out.push({kind: "field", entity: entity.id, id: field.id,
        ...(now.displayName !== was.displayName ? {displayName: now.displayName.trim() || null} : {}),
        ...(now.description !== was.description ? {description: now.description} : {}),
        ...(!same(now.constraints, was.constraints) ? {constraints: {required: !!now.constraints.required, nullable: !!now.constraints.nullable, unique: !!now.constraints.unique, enum: now.constraints.enum ?? []}} : {})});
    }
    return out;
  }, [draft, original, entity]);
  const setField = (id: string, change: Partial<FieldDraft>) => setDraft(d => ({...d, fields: {...d.fields, [id]: {...d.fields[id], ...change}}}));
  const setConstraint = (id: string, change: FieldConstraints) => setDraft(d => {
    const constraints: FieldConstraints = {...d.fields[id].constraints, ...change};
    for (const key of ["required", "nullable", "unique"] as const) if (!constraints[key]) delete constraints[key];
    if (!constraints.enum?.length) delete constraints.enum;
    return {...d, fields: {...d.fields, [id]: {...d.fields[id], constraints}}};
  });

  const status = completeness(model, "entity", entity.id, issues), binding = model.bindings[entity.id];
  const outgoing = model.relationships.filter(r => r.from === entity.id), incoming = model.relationships.filter(r => r.to === entity.id);
  const actions = model.actions.filter(a => a.entity === entity.id || a.appliesTo === entity.id);
  const rules = model.rules.filter(r => r.appliesTo === entity.id || r.constraint?.field?.startsWith(`${entity.id}.`));
  const own = issues.filter(i => i.element?.view === "entity" && i.element.id === entity.id);

  return <section className="bm-entity" aria-label={`对象 ${entity.id}`}>
    <header className="bm-entity-head">
      <div><h2>{entityLabel(entity)} <code>{entity.id}</code></h2><Completeness value={status}/></div>
      <div className="bm-actions">
        <Button size="sm" variant="ghost" disabled={!patches.length || busy} onClick={() => setDraft(original)}><RotateCcw size={13}/>重置</Button>
        <Button size="sm" disabled={!patches.length || busy} onClick={() => void onSave(patches, `已保存「${entityLabel(entity)}」的 ${patches.length} 项修改`)}><Save size={13}/>保存{patches.length ? `（${patches.length}）` : ""}</Button>
      </div>
    </header>
    <div className="bm-form-grid">
      <label className="model-field">显示名称<input value={draft.displayName} placeholder={entity.synonyms[0] ?? entity.id} onChange={e => setDraft(d => ({...d, displayName: e.target.value}))}/>
        <small>稳定标识 {entity.id} 不随显示名称变化</small></label>
      <label className="model-field">数据来源<input value={entity.source ?? ""} readOnly/><small>{entity.source?.startsWith("semantic.") ? "拟建语义视图，非已接通数据源" : "来源声明"}</small></label>
      <label className="model-field bm-wide">业务定义<textarea className="bm-textarea" rows={2} value={draft.description} onChange={e => setDraft(d => ({...d, description: e.target.value}))}/></label>
    </div>
    <div className="bm-keys"><span><KeyRound size={12}/>主键 {entity.primaryKey.map(k => <code key={k}>{k}</code>)}</span>
      {entity.uniqueKeys.map((keys, i) => <span key={i}>唯一键 {keys.map(k => <code key={k}>{k}</code>)}</span>)}
      {entity.synonyms.length > 0 && <span>同义词 {entity.synonyms.join("、")}</span>}</div>
    {own.length > 0 && <ul className="bm-issue-list">{own.map((issue, i) => <IssueLine key={i} issue={issue}/>)}</ul>}

    <div className="table-card"><div className="table-scroll"><table className="bm-fields"><caption className="sr-only">字段</caption>
      <thead><tr><th>字段</th><th>类型</th><th>显示名称</th><th>描述</th><th>约束</th></tr></thead>
      <tbody>{entity.fields.map(field => {
        const d = draft.fields[field.id], candidate = enumCandidate(field), confirmed = d.constraints.enum?.length ? d.constraints.enum : undefined;
        return <tr key={field.id} data-field={field.id}>
          <td><code>{field.id}</code>{entity.primaryKey.includes(field.id) && <span className="bm-pk">PK</span>}{field.isTime && <Clock size={11} className="bm-time" aria-label="时间维度"/>}</td>
          <td>{fieldTypeLabels[field.type as FieldType] ?? field.type}</td>
          <td><input className="bm-cell-input" aria-label={`${field.id} 显示名称`} value={d.displayName} placeholder={fieldLabel(field)} onChange={e => setField(field.id, {displayName: e.target.value})}/></td>
          <td><input className="bm-cell-input wide" aria-label={`${field.id} 描述`} value={d.description} onChange={e => setField(field.id, {description: e.target.value})}/></td>
          <td><div className="bm-constraints">
            {(["required", "nullable", "unique"] as const).map(key => <label key={key}><input type="checkbox" checked={!!d.constraints[key]} onChange={e => setConstraint(field.id, {[key]: e.target.checked})}/>{{required: "必填", nullable: "可空", unique: "唯一"}[key]}</label>)}
            {confirmed ? <span className="bm-enum">{confirmed.map(v => <code key={v}>{v}</code>)}<button type="button" onClick={() => setConstraint(field.id, {enum: undefined})}>取消枚举</button></span>
              : candidate ? <span className="bm-enum inferred" title="从描述推断，需确认后成为正式约束（BMF §8.2）"><Sparkles size={11}/>{candidate.values.map(v => <code key={v}>{v}</code>)}
                <button type="button" onClick={() => setConstraint(field.id, {enum: candidate.values})}>确认为枚举</button></span> : null}
          </div></td>
        </tr>;
      })}</tbody></table></div></div>

    <div className="bm-related">
      <section><h3>应用设计</h3>
        {binding ? <p className="bm-footnote">已绑定数据模型 <code>{binding.objectType}</code>（{binding.boundAt.slice(0, 16).replace("T", " ")}）</p>
          : <p className="bm-footnote">把该对象投影为应用数据模型，并沿用现有路径生成「列表 + 详情」「详情」「新建 / 编辑」页面。已绑定对象的关系会生成关联属性。</p>}
        <div className="bm-actions">
          <Button size="sm" variant={binding ? "outline" : "default"} disabled={busy} onClick={() => void onCreatePages(entity.id)}><Wand2 size={13}/>{binding ? "同步数据模型" : "创建页面"}</Button>
          {binding && <Button asChild size="sm" variant="outline"><a href={`/apps/${binding.objectType}`}>打开页面<ArrowUpRight size={13}/></a></Button>}
          {binding && <Button asChild size="sm" variant="ghost"><a href={`/editor?page=${encodeURIComponent(`${binding.objectType}-list-detail`)}`}>页面设计器</a></Button>}
        </div>
      </section>
      <section><h3>关系</h3><ul className="bm-mini">
        {outgoing.map(r => <li key={r.id}>→ <button type="button" onClick={() => onOpenEntity(r.to)}>{r.to}</button> <small>{r.fromColumns.join(",")} = {r.toColumns.join(",")}</small></li>)}
        {incoming.map(r => <li key={r.id}>← <button type="button" onClick={() => onOpenEntity(r.from)}>{r.from}</button> <small>{r.fromColumns.join(",")}</small></li>)}
        {!outgoing.length && !incoming.length && <li className="bm-footnote">无</li>}</ul></section>
      <section><h3>行为（{actions.length}）</h3><ul className="bm-mini">{actions.map(a => <li key={a.id}><KindBadge kind={a.kind}/> {a.name} <small>{a.id}</small></li>)}</ul></section>
      <section><h3>规则（{rules.length}）</h3><ul className="bm-mini">{rules.map(r => <li key={r.id}>{r.name} <small>{r.id}</small></li>)}{!rules.length && <li className="bm-footnote">无</li>}</ul></section>
    </div>
  </section>;
}

// ── Relationships ───────────────────────────────────────────────────────────
function Relationships({model, issues, onOpenEntity}: {model: BusinessModel; issues: ModelIssue[]; onOpenEntity: (id: string) => void}) {
  const width = 960, height = 540, cx = width / 2, cy = height / 2;
  const positions = new Map(model.entities.map((e, i) => {
    const angle = (i / Math.max(model.entities.length, 1)) * Math.PI * 2 - Math.PI / 2;
    return [e.id, {x: cx + Math.cos(angle) * 380, y: cy + Math.sin(angle) * 215}];
  }));
  const broken = new Set(issues.filter(i => i.element?.view === "relationship" && i.severity === "error").map(i => i.element!.id));
  return <div className="bm-stack">
    <figure className="bm-graph"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="对象关系图">
      <defs><marker id="bm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#9aa5b1"/></marker></defs>
      {model.relationships.map(r => {
        const a = positions.get(r.from), b = positions.get(r.to);
        if (!a || !b) return null;
        // Clip the segment to the 124×40 node boxes so arrowheads touch the border.
        const dx = b.x - a.x, dy = b.y - a.y, t = Math.min(64 / Math.abs(dx || 1e-9), 22 / Math.abs(dy || 1e-9), 0.45);
        return <line key={r.id} x1={a.x + dx * t} y1={a.y + dy * t} x2={b.x - dx * t} y2={b.y - dy * t} className={broken.has(r.id) ? "broken" : undefined} markerEnd="url(#bm-arrow)"><title>{`${r.id}: ${r.from}.${r.fromColumns.join(",")} → ${r.to}.${r.toColumns.join(",")}`}</title></line>;
      })}
      {model.entities.map(e => { const p = positions.get(e.id)!; return <g key={e.id} transform={`translate(${p.x},${p.y})`} className="bm-node" onClick={() => onOpenEntity(e.id)} role="button" tabIndex={0} aria-label={`打开 ${e.id}`}
        onKeyDown={event => { if (event.key === "Enter") onOpenEntity(e.id); }}>
        <rect x={-62} y={-20} width={124} height={40} rx={8}/><text y={-3}>{entityLabel(e)}</text><text y={12} className="id">{e.id}</text></g>; })}
    </svg><figcaption>箭头从引用方指向被引用方；点击节点打开对象。</figcaption></figure>
    <div className="table-card"><div className="table-scroll"><table><caption className="sr-only">关系</caption>
      <thead><tr><th>关系</th><th>源对象</th><th>源字段</th><th>目标对象</th><th>目标字段</th><th>业务含义</th></tr></thead>
      <tbody>{model.relationships.map(r => <tr key={r.id}><td><code>{r.id}</code>{broken.has(r.id) && <Badge variant="destructive" className="bm-inline">引用错误</Badge>}</td>
        <td>{r.from}</td><td>{r.fromColumns.join(", ")}</td><td>{r.to}</td><td>{r.toColumns.join(", ")}</td><td>{r.synonyms.join("、")}</td></tr>)}</tbody></table></div></div>
  </div>;
}

// ── Actions ─────────────────────────────────────────────────────────────────
function Actions({model, issues}: {model: BusinessModel; issues: ModelIssue[]}) {
  const [kind, setKind] = useState<"all" | "query" | "command">("all"), [query, setQuery] = useState(""), [open, setOpen] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const visible = model.actions.filter(a => (kind === "all" || a.kind === kind) && (!q || [a.id, a.name, a.entity ?? "", a.description].join(" ").toLowerCase().includes(q)));
  return <div className="bm-stack">
    <div className="catalog-toolbar"><div className="origin-filter">{(["all", "query", "command"] as const).map(k => <button type="button" key={k} aria-pressed={kind === k} className={kind === k ? "active" : undefined} onClick={() => setKind(k)}>
      {{all: "全部", query: "查询 Query", command: "命令 Command"}[k]} <small>{k === "all" ? model.actions.length : model.actions.filter(a => a.kind === k).length}</small></button>)}</div>
      <label className="catalog-search"><Search size={14}/><span className="sr-only">搜索操作</span><input value={query} placeholder="搜索 ID、名称、对象…" onChange={e => setQuery(e.target.value)}/></label></div>
    <div className="table-card"><div className="table-scroll"><table><caption className="sr-only">业务行为</caption>
      <thead><tr><th>操作</th><th>类型</th><th>对象</th><th>可执行角色</th><th>规则</th><th>完成度</th></tr></thead>
      <tbody>{visible.map(a => { const rules = model.rules.filter(r => r.scope.actionIds.includes(a.id)), c = completeness(model, "action", a.id, issues);
        return <Fragment key={a.id}><tr className="bm-clickable" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
          <td><div className="resource-name"><div><strong>{a.name}</strong><p>{a.id}</p></div></div></td><td><KindBadge kind={a.kind}/></td><td>{a.entity}</td>
          <td>{a.roles.map(r => <span key={r} className="type-badge catalog-tag">{r}</span>)}</td><td>{rules.length || "—"}</td><td><Completeness value={c} compact/></td></tr>
          {open === a.id && <tr className="bm-detail-row"><td colSpan={6}><ActionDetail action={a} rules={rules.map(r => r.id)}/></td></tr>}</Fragment>; })}</tbody></table>
      {!visible.length && <Empty text="没有匹配的操作"/>}</div></div>
  </div>;
}
function ActionDetail({action, rules}: {action: BmAction; rules: string[]}) {
  return <div className="bm-action-detail">
    <p>{action.description}</p>
    <div className="bm-two">
      <SchemaTable title="输入" schema={action.inputSchema}/>
      <SchemaTable title="输出" schema={action.outputSchema}/>
    </div>
    <dl className="bm-meta">
      <dt>operation</dt><dd>{action.operation}</dd>
      {action.labels.length > 0 && <><dt>labels</dt><dd>{action.labels.join(", ")}</dd></>}
      {action.governance && Object.entries(action.governance).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>)}
      <dt>引用规则</dt><dd>{rules.length ? rules.join("、") : "无（规则作用域未指向该操作）"}</dd>
    </dl>
  </div>;
}
function SchemaTable({title, schema}: {title: string; schema?: JsonSchema}) {
  const props = Object.entries(schema?.properties ?? {}), required = new Set(schema?.required ?? []);
  return <section><h3>{title}</h3>{props.length ? <table className="bm-schema"><tbody>{props.map(([key, p]) => <tr key={key}>
    <td><code>{key}</code>{required.has(key) && <span className="bm-req">*</span>}</td><td>{p.type ?? "any"}</td>
    <td>{p.enum ? p.enum.map(String).join(" / ") : p.description ?? ""}{p.default !== undefined ? ` 默认 ${JSON.stringify(p.default)}` : ""}</td></tr>)}</tbody></table> : <p className="bm-footnote">未定义</p>}</section>;
}

// ── Rules ───────────────────────────────────────────────────────────────────
function Rules({model, issues}: {model: BusinessModel; issues: ModelIssue[]}) {
  const flagged = new Map<string, ModelIssue[]>();
  for (const issue of issues) if (issue.element?.view === "rule") flagged.set(issue.element.id, [...(flagged.get(issue.element.id) ?? []), issue]);
  return <div className="table-card"><div className="table-scroll"><table className="bm-wrap"><caption className="sr-only">业务规则</caption>
    <thead><tr><th>规则</th><th>级别</th><th>适用对象</th><th>作用操作</th><th>约束</th><th>说明与处置</th></tr></thead>
    <tbody>{model.rules.map(r => <tr key={r.id}>
      <td><div className="resource-name"><div><strong>{r.name}</strong><p>{r.id}</p></div></div></td>
      <td><Badge variant={r.severity === "error" ? "destructive" : "secondary"}>{r.severity}</Badge></td>
      <td>{r.appliesTo}</td>
      <td>{r.scope.actionIds.length ? r.scope.actionIds.map(id => <code key={id} className="bm-block">{id}</code>) : <span className="bm-warn" title={flagged.get(r.id)?.map(i => i.message).join("\n")}><AlertTriangle size={11}/>未指定</span>}</td>
      <td><code className="bm-block">{r.constraint?.predicate}</code><small className="bm-footnote">{r.constraint?.field} · {r.constraint?.enforcement}</small></td>
      <td>{r.message}<small className="bm-footnote">{r.remediation}</small></td>
    </tr>)}</tbody></table></div></div>;
}

// ── Roles ───────────────────────────────────────────────────────────────────
function Roles({model, roles}: {model: BusinessModel; roles: ReturnType<typeof inferRoles>}) {
  const groups = [...new Set(model.actions.map(a => a.entity ?? "—"))];
  return <div className="bm-stack">
    <p className="bm-callout"><Info size={13}/>角色由各操作的 <code>authorization.allowed_roles</code> 推断（{roles.map(r => r.id).join("、")}），标记为推断；实际身份必须来自可信上下文，输入中的角色不能作为授权依据（BMF §4.3）。</p>
    <div className="table-card"><div className="table-scroll"><table className="bm-matrix"><caption className="sr-only">角色与操作矩阵</caption>
      <thead><tr><th>操作</th>{roles.map(r => <th key={r.id}>{r.id}<small>{r.actions.length}</small></th>)}</tr></thead>
      <tbody>{groups.map(group => <Fragment key={group}><tr className="bm-group"><td colSpan={roles.length + 1}>{group}</td></tr>
        {model.actions.filter(a => (a.entity ?? "—") === group).map(a => <tr key={a.id}><td><KindBadge kind={a.kind}/> {a.name} <small>{a.id}</small></td>
          {roles.map(r => <td key={r.id} aria-label={a.roles.includes(r.id) ? `${r.id} 可执行` : `${r.id} 不可执行`}>{a.roles.includes(r.id) ? "●" : ""}</td>)}</tr>)}</Fragment>)}</tbody></table></div></div>
  </div>;
}

// ── Metrics ─────────────────────────────────────────────────────────────────
function Metrics({model, issues}: {model: BusinessModel; issues: ModelIssue[]}) {
  return <div className="table-card"><div className="table-scroll"><table className="bm-wrap"><caption className="sr-only">业务指标</caption>
    <thead><tr><th>指标</th><th>口径说明</th><th>表达式（ANSI SQL）</th><th>完成度</th></tr></thead>
    <tbody>{model.metrics.map(m => <tr key={m.id}><td><code>{m.id}</code></td><td>{m.description}</td><td><code className="bm-block">{m.expression}</code></td>
      <td><Completeness value={completeness(model, "metric", m.id, issues)} compact/></td></tr>)}</tbody></table></div></div>;
}

// ── States & events ─────────────────────────────────────────────────────────
function Lifecycle({model, states, events, onOpenEntity}: {model: BusinessModel; states: ReturnType<typeof inferStates>; events: ReturnType<typeof inferEvents>; onOpenEntity: (id: string) => void}) {
  return <div className="bm-stack">
    <p className="bm-callout"><Sparkles size={13}/>源文件没有显式的状态机、事件、流程和文档定义。以下状态候选来自 status 字段描述，事件来自 <code>*_event</code> 数据集的类型字段，均为推断项；合法迁移、守卫与触发操作需要在后续迭代中正式定义。</p>
    <section className="bm-section"><h2>状态候选（{states.length}）</h2><div className="bm-state-grid">{states.map(s => <article key={s.id} className="bm-state">
      <header><button type="button" onClick={() => onOpenEntity(s.entity)}>{entityLabel(model.entities.find(e => e.id === s.entity)!)}</button><code>{s.entity}.{s.field}</code><Badge variant="outline" className="bm-inferred">推断</Badge></header>
      <div className="bm-chain">{s.values.map(v => <code key={v}>{v}</code>)}</div></article>)}</div></section>
    <section className="bm-section"><h2>业务事件候选（{events.length}）</h2>
      <div className="table-card"><table><thead><tr><th>事件</th><th>记录对象</th><th>产生操作（由描述推断）</th></tr></thead>
        <tbody>{events.map(e => <tr key={e.id}><td><code>{e.name}</code> <Badge variant="outline" className="bm-inferred">推断</Badge></td><td>{e.entity}.{e.field}</td><td>{e.producedBy.join("、") || "—"}</td></tr>)}</tbody></table></div></section>
    <div className="bm-two">
      <section className="bm-section muted"><h2>{viewLabels.process}</h2><p className="bm-footnote">未定义。采购申请 → 审批 → 下单 → 验收 → 入库可作为首个流程，引用已有操作。</p></section>
      <section className="bm-section muted"><h2>{viewLabels.document}</h2><p className="bm-footnote">未定义。采购订单、验收单、借阅规章等可在后续迭代中定义为文档类型。</p></section>
    </div>
  </div>;
}

// ── Issues ──────────────────────────────────────────────────────────────────
function Issues({issues}: {issues: ModelIssue[]}) {
  if (!issues.length) return <Empty text="没有发现问题"/>;
  return <div className="table-card"><div className="table-scroll"><table className="bm-wrap"><caption className="sr-only">问题清单</caption>
    <thead><tr><th>级别</th><th>位置</th><th>元素</th><th>说明</th></tr></thead>
    <tbody>{issues.map((issue, i) => <tr key={i}><td><SeverityBadge severity={issue.severity}/></td><td><code>{issue.path}</code></td>
      <td>{issue.element ? `${viewLabels[issue.element.view]} · ${issue.element.id}` : "—"}</td><td>{issue.message}</td></tr>)}</tbody></table></div></div>;
}

// ── Small pieces ────────────────────────────────────────────────────────────
function Completeness({value, compact}: {value: ReturnType<typeof completeness>; compact?: boolean}) {
  const items = [
    {on: value.defined, label: value.defined ? "已定义" : "草稿"},
    {on: value.validation === "validated", label: value.validation === "validated" ? "已校验" : "有阻塞问题", bad: value.validation === "blocked"},
    {on: value.bound, label: value.bound ? "已绑定" : "未绑定"},
    {on: value.verified, label: value.verified ? "已验证" : "未验证"},
  ];
  return <span className={`bm-completeness${compact ? " compact" : ""}`} aria-label={items.map(i => i.label).join("，")}>
    {items.map(item => <span key={item.label} className={item.bad ? "bad" : item.on ? "on" : undefined} title={item.label}>{compact ? "" : item.label}</span>)}</span>;
}
function KindBadge({kind}: {kind: string}) {
  return <span className={`bm-kind ${kind}`}>{kind === "query" ? "查询" : kind === "command" ? "命令" : kind}</span>;
}
function SeverityBadge({severity}: {severity: ModelIssue["severity"]}) {
  return <Badge variant={severity === "error" ? "destructive" : severity === "warning" ? "secondary" : "outline"}>{{error: "错误", warning: "提醒", info: "信息"}[severity]}</Badge>;
}
function IssueLine({issue}: {issue: ModelIssue}) {
  return <li><SeverityBadge severity={issue.severity}/><span>{issue.message}<code>{issue.path}</code></span></li>;
}
function Empty({text}: {text: string}) {
  return <div className="table-empty"><Search size={22}/><span>{text}</span></div>;
}
