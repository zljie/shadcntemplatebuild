"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, DatabaseZap, RefreshCw, ShieldAlert, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { Release } from "@/server/opc-platform";
import { opc, errorText } from "./api";
import { Empty } from "./frame";
import { releaseStatus, short } from "./release-center";

type Compiled = {source: string; tables: number; operations: {operationId: string; kind: string; roles: string[]; documentSha256: string}[]};
type Check = {at: string; ready: boolean; blockers: string[]};

/** Data mappings of a release (model field → table column), their compiled operations and the Hasura sync state. */
export function MappingView({release, hasura}: {release: Release; hasura: boolean | null}) {
  const router = useRouter();
  const [mappingId, setMappingId] = useState(release.mappings[0]?.id ?? "");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [check, setCheck] = useState<Check | null>(null), [compiled, setCompiled] = useState<Compiled | null>(null), [confirm, setConfirm] = useState(false);
  const mapping = release.mappings.find(m => m.id === mappingId);
  const readiness = release.readiness["db-connect"];
  const sync = check ?? (readiness ? {at: readiness.reportedAt, ready: readiness.ready, blockers: readiness.blockers} : null);
  const drift = sync?.blockers.filter(b => /hasura|drift|漂移|allowlist|permission/i.test(b)) ?? [];

  async function run(work: () => Promise<string>) {
    setBusy(true); setError(""); setNotice("");
    try { setNotice(await work()); router.refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setConfirm(false); }
  }
  const checkSync = () => run(async () => {
    const res = await opc<{ready: boolean; blockers: string[]}>("db-connect", `releases/${release.id}/prepare`, {method: "POST"});
    if (!res.ok) throw new Error(`检查失败：${errorText(res.body, res.status)}`);
    setCheck({at: new Date().toISOString(), ...res.body});
    return res.body.ready ? "Hasura 元数据与发布一致" : `发现 ${res.body.blockers.length} 个问题`;
  });
  const compile = () => run(async () => {
    const res = await opc<Compiled>("db-connect", `mappings/${encodeURIComponent(mappingId)}/compile`, {method: "POST"});
    if (!res.ok) throw new Error(`编译失败：${errorText(res.body, res.status)}`);
    setCompiled(res.body);
    return `已编译并应用到 Hasura source ${res.body.source}：${res.body.tables} 张表，${res.body.operations.length} 个 Operation`;
  });

  if (!release.mappings.length) return <div className="platform-card"><Empty>发布 {short(release.id)} 没有数据映射</Empty></div>;
  return <>
    <div className="catalog-stats">
      <Stat label="映射" value={release.mappings.length}/>
      <Stat label="映射对象" value={release.mappings.reduce((n, m) => n + m.entities.length, 0)}/>
      <Stat label="可操作对象" value={release.mappings.reduce((n, m) => n + m.entities.filter(e => e.allowedOperations.length).length, 0)}/>
      <Stat label="编译出的 Operation" value={release.operations.length}/>
    </div>
    <p className="catalog-notice" role="status">{busy ? "处理中…" : notice}</p>
    {error && <div className="bm-alert" role="alert"><ShieldAlert size={14}/><div><strong>{error}</strong></div></div>}

    <div className="platform-split">
      <div className="platform-card" aria-label="映射与就绪">
        <header><div><h3>{mapping?.id}</h3><p className="platform-mono">发布 {short(release.id)} · <span className={`platform-chip ${releaseStatus[release.status].tone}`}>{releaseStatus[release.status].label}</span></p></div>
          {release.mappings.length > 1 && <select aria-label="选择映射" value={mappingId} onChange={e => setMappingId(e.target.value)}>{release.mappings.map(m => <option key={m.id}>{m.id}</option>)}</select>}</header>
        {mapping && <dl className="platform-kv">
          <dt>模型包</dt><dd><code>{mapping.packageRef.id}@{mapping.packageRef.version}</code></dd>
          <dt>连接引用</dt><dd><code>{mapping.connectionRef}</code><small>（只存引用，不存凭据）</small></dd>
          <dt>Hasura source</dt><dd><code>{mapping.hasuraSource}</code></dd>
          <dt>对象</dt><dd>{mapping.entities.length} 个，其中 {mapping.entities.filter(e => e.allowedOperations.length).length} 个允许数据操作（其余默认拒绝）</dd>
        </dl>}
        <div><h4>就绪</h4><ul className="platform-list">
          <li><code>Hasura</code>{hasura === null ? <span className="platform-chip">未知</span> : <span className={`platform-chip ${hasura ? "ok" : "bad"}`}>{hasura ? "可达" : "不可达"}</span>}</li>
          <li><code>同步</code>{sync ? <><span className={`platform-chip ${sync.ready ? "ok" : "bad"}`}>{sync.ready ? "元数据与发布一致" : "未就绪"}</span><small>{sync.at.slice(0, 19).replace("T", " ")}{check ? " · 刚刚检查" : " · db-connect 上次报告"}</small></> : <span className="platform-chip">尚未检查</span>}</li>
          {(drift.length ? drift : sync?.blockers ?? []).map(b => <li key={b} className="record-field-error">{b}</li>)}
        </ul></div>
        <div className="platform-actions">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void checkSync()}><CheckCircle2 size={13}/>检查 Hasura 同步</Button>
          <Button size="sm" variant="ghost" disabled={busy || !mapping} onClick={() => setConfirm(true)}><RefreshCw size={13}/>重新编译并应用</Button>
        </div>
        {compiled && <div><h4>编译结果</h4><ul className="platform-list">{compiled.operations.map(o => <li key={o.operationId}><code>{o.operationId}</code><small>{o.kind} · {o.roles.join(", ")} · {o.documentSha256.slice(7, 19)}</small></li>)}</ul></div>}
      </div>

      <div className="platform-card" aria-label="编译出的 Operation">
        <h3><DatabaseZap size={14}/> 发布中的 Operation</h3>
        <ul className="platform-list">{release.operations.filter(o => o.mappingId === mappingId).map(o => <li key={o.operationId}><code>{o.operationId}</code>
          <span className={`platform-chip ${o.operationType === "mutation" ? "warn" : "info"}`}>{o.kind}</span><small>{o.entityId} · {o.authorization.roles.join(", ")} · 最多 {o.queryLimits.maxRows} 行</small></li>)}</ul>
      </div>
    </div>

    <section className="platform-section">
      <h2><Table2 size={15}/> 对象 → 表 <small>字段 → 列；允许的数据操作默认拒绝</small></h2>
      <div className="table-card"><div className="table-scroll"><table className="platform-table"><caption className="sr-only">映射对象</caption>
        <thead><tr><th>对象</th><th>表</th><th>字段 → 列</th><th>允许操作</th><th>关系</th><th>Operation</th></tr></thead>
        <tbody>{mapping?.entities.map(e => { const ops = release.operations.filter(o => o.entityId === e.entityId && o.mappingId === mapping.id);
          return <tr key={e.entityId}>
            <td><strong>{e.entityId}</strong>{e.tenantField && <p><span className="platform-chip info">租户字段 {e.tenantField}</span></p>}</td>
            <td className="platform-mono">{e.table}</td>
            <td><ul className="model-properties">{Object.entries(e.columns).map(([f, c]) => <li key={f} title={`${f} → ${c}`}>{f}{f !== c && <small>→ {c}</small>}</li>)}</ul></td>
            <td>{e.allowedOperations.length ? e.allowedOperations.map(op => <span key={op} className="platform-chip ok catalog-tag">{op}</span>) : <span className="platform-chip">默认拒绝</span>}</td>
            <td>{e.relationships.length ? <ul className="platform-list">{e.relationships.map(r => <li key={r.name}><code>{r.name}</code><small>{r.kind} → {r.target}</small></li>)}</ul> : "—"}</td>
            <td>{ops.length ? <ul className="platform-list">{ops.map(o => <li key={o.operationId}><code>{o.operationId}</code></li>)}</ul> : <span className="platform-chip">无</span>}</td>
          </tr>; })}</tbody></table></div></div>
    </section>

    <Dialog open={confirm} onOpenChange={open => { if (!open && !busy) setConfirm(false); }}><DialogContent><DialogTitle>重新编译映射 {mappingId}</DialogTitle>
      <DialogDescription>db-connect 会按映射和模型重新生成 Hasura 元数据（表跟踪、角色权限、allowlist）并整体替换，再登记 Operation。输入不变时结果不变；Hasura 只保留最近一次编译的文档，旧发布在准备阶段可能因漂移被阻塞。</DialogDescription>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>取消</Button><Button disabled={busy} onClick={() => void compile()}>{busy ? "编译中…" : "编译并应用"}</Button></DialogFooter></DialogContent></Dialog>
  </>;
}

function Stat({label, value}: {label: string; value: number}) {
  return <div className="catalog-stat"><span><DatabaseZap size={16}/></span><div><b>{value}</b><small>{label}</small></div></div>;
}
