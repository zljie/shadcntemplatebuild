"use client";
import { useMemo, useState } from "react";
import { Boxes, Search } from "lucide-react";
import type { Operation } from "@/server/opc-platform";
import { Empty } from "./frame";

/** Registered operations of one model package: fixed GraphQL documents, their roles, hash and whether the active release uses them. */
export function OperationCatalog({operations, inRelease, releaseId}: {operations: Operation[]; inRelease: string[]; releaseId: string | null}) {
  const [query, setQuery] = useState(""), [selectedId, setSelectedId] = useState(operations[0]?.operationId ?? null);
  const used = useMemo(() => new Set(inRelease), [inRelease]);
  const visible = operations.filter(o => `${o.operationId} ${o.entityId} ${o.actionId} ${o.authorization.roles.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const selected = operations.find(o => o.operationId === selectedId) ?? null;
  return <>
    <div className="catalog-stats">
      <Stat label="已登记" value={operations.length}/>
      <Stat label="已启用（approved）" value={operations.filter(o => o.status === "approved").length}/>
      <Stat label="写操作" value={operations.filter(o => o.operationType === "mutation").length}/>
      <Stat label="当前发布使用" value={operations.filter(o => used.has(o.operationId)).length}/>
    </div>
    <div className="catalog-toolbar"><span/><label className="catalog-search"><Search size={14}/><span className="sr-only">搜索 Operation</span><input value={query} placeholder="搜索 operationId、对象、Action 或角色…" onChange={e => setQuery(e.target.value)}/></label></div>
    <div className="platform-split" style={{marginTop: 12}}>
      <div className="table-card"><div className="table-scroll"><table className="platform-table"><caption className="sr-only">Operation 目录</caption>
        <thead><tr><th>Operation</th><th>类型</th><th>角色</th><th>Hash</th><th>状态</th></tr></thead>
        <tbody>{visible.map(o => <tr key={o.operationId} data-active={o.operationId === selectedId}>
          <td><button className="link" onClick={() => setSelectedId(o.operationId)} aria-pressed={o.operationId === selectedId}>{o.operationId}</button><p className="platform-mono">{o.entityId} · {o.actionId}</p></td>
          <td><span className={`platform-chip ${o.operationType === "mutation" ? "warn" : "info"}`}>{o.kind}</span></td>
          <td>{o.authorization.roles.map(r => <span key={r} className="type-badge catalog-tag">{r}</span>)}</td>
          <td className="platform-mono" title={o.documentSha256}>{o.documentSha256.slice(7, 19)}</td>
          <td><span className={`platform-chip ${o.status === "approved" ? "ok" : "bad"}`}>{o.status === "approved" ? "已启用" : "已停用"}</span>{used.has(o.operationId) && <p><span className="platform-chip info">发布中</span></p>}</td>
        </tr>)}</tbody></table>
        {!visible.length && <Empty>{operations.length ? "没有匹配的 Operation" : "这个模型包还没有登记 Operation：在数据映射页编译映射"}</Empty>}</div></div>
      {selected ? <section className="platform-card" aria-label={`Operation ${selected.operationId}`}>
        <header><div><h3>{selected.operationId}</h3><p className="platform-mono">{selected.packageRef.id}@{selected.version}</p></div><span className={`platform-chip ${selected.status === "approved" ? "ok" : "bad"}`}>{selected.status}</span></header>
        <dl className="platform-kv">
          <dt>授权 Action</dt><dd><code>{selected.actionId}</code>（角色与模型 Action 的 allowedRoles 一致）</dd>
          <dt>角色</dt><dd>{selected.authorization.roles.join(", ")} · 租户 {selected.authorization.tenantScope}</dd>
          <dt>对象 / 映射</dt><dd><code>{selected.entityId}</code> · <code>{selected.mappingId}</code></dd>
          <dt>文档 hash</dt><dd><code>{selected.documentSha256}</code></dd>
          <dt>限制</dt><dd>最多 {selected.queryLimits.maxRows} 行 · 深度 {selected.queryLimits.maxDepth}</dd>
          <dt>当前发布</dt><dd>{used.has(selected.operationId) ? `被 ${releaseId ?? "当前发布"} 冻结引用` : "未使用"}</dd>
        </dl>
        <div><h4>固定 GraphQL 文档</h4><pre className="platform-json">{selected.document}</pre></div>
        <div><h4>变量 Schema</h4><pre className="platform-json">{JSON.stringify(selected.variablesSchema, null, 2)}</pre></div>
      </section> : <div className="platform-card"><Empty>选择一个 Operation 查看文档</Empty></div>}
    </div>
  </>;
}

function Stat({label, value}: {label: string; value: number}) {
  return <div className="catalog-stat"><span><Boxes size={16}/></span><div><b>{value}</b><small>{label}</small></div></div>;
}
