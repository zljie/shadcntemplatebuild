"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CheckCircle2, GitCompare, Link2, Plus, Rocket, ShieldAlert, Unlink, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import type { Release } from "@/server/opc-platform";
import type { BindingCandidate } from "@/server/platform-bindings";
import { opc, errorText } from "./api";
import { Empty } from "./frame";
import { diffReleases } from "./release-diff";

export const releaseStatus: Record<Release["status"], {label: string; tone: string}> = {
  BLOCKED: {label: "有阻塞项", tone: "bad"}, PENDING_READINESS: {label: "待就绪", tone: "warn"}, READY: {label: "可启用", tone: "info"},
  ACTIVE: {label: "已启用", tone: "ok"}, SUPERSEDED: {label: "已被替换", tone: ""},
};
export const short = (id: string, n = 12) => (id.length > n + 4 ? `${id.slice(0, n)}…` : id);
const time = (iso?: string) => (iso ? iso.slice(0, 19).replace("T", " ") : "—");

type Item = {id: string; release: Release | null};
type Confirm = {title: string; description: string; action: () => Promise<void>};

export function ReleaseCenter({releases, activeId, candidates: all}: {releases: Item[]; activeId: string | null; candidates: BindingCandidate[]}) {
  const bindable = (c: BindingCandidate) => !!c.suggestion.dataSource || c.suggestion.commands.length > 0 || !!c.current.dataSource || c.current.commands.length > 0;
  const [showAll, setShowAll] = useState(false);
  const candidates = showAll ? all : all.filter(bindable), hidden = all.length - all.filter(bindable).length;
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(activeId ?? releases[0]?.id ?? null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Confirm | null>(null), [creating, setCreating] = useState<string | null>(null);
  const active = releases.find(r => r.id === activeId)?.release ?? null;
  const selected = releases.find(r => r.id === selectedId)?.release ?? null;
  const diff = useMemo(() => (active && selected && active.id !== selected.id ? diffReleases(active, selected) : null), [active, selected]);

  async function run(work: () => Promise<string>) {
    setBusy(true); setError(""); setNotice("");
    try { setNotice(await work()); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setConfirm(null); }
  }
  const must = async <T,>(p: Promise<{ok: boolean; status: number; body: T}>, what: string) => { const r = await p; if (!r.ok) throw new Error(`${what}失败：${errorText(r.body, r.status)}`); return r.body; };

  const prepare = (release: Release) => run(async () => {
    const db = await must(opc<{ready: boolean; blockers: string[]}>("db-connect", `releases/${release.id}/prepare`, {method: "POST"}), "db-connect 准备");
    const bff = await must(opc<{ready: boolean; blockers: string[]}>("bff", `releases/${release.id}/prepare`, {method: "POST"}), "BFF 准备");
    const blockers = [...db.blockers.map(b => `db-connect：${b}`), ...bff.blockers.map(b => `bff：${b}`)];
    if (blockers.length) throw new Error(`未就绪：${blockers.join("；")}`);
    return `${short(release.id)} 两端均已就绪，可以启用`;
  });
  const activate = (release: Release) => setConfirm({
    title: `启用发布 ${short(release.id, 20)}`,
    description: `应用 ${release.app} 的流量将切到这个发布（${release.packageRef.id}@${release.packageRef.version}），当前启用的发布变为「已被替换」。启用后通知 BFF 重新加载。`,
    action: () => run(async () => {
      await must(opc("meta-data", `releases/${release.id}/activate`, {method: "POST"}), "启用");
      const reload = await opc<{loaded?: boolean; blockers?: string[]}>("bff", "reload", {method: "POST"});
      if (!reload.ok) throw new Error(`已启用，但 BFF 重新加载失败：${errorText(reload.body, reload.status)}`);
      setSelectedId(release.id);
      return `已启用 ${short(release.id)}，BFF 已加载`;
    }),
  });
  const create = (text: string) => run(async () => {
    let profile: unknown;
    try { profile = JSON.parse(text); } catch { throw new Error("运行方案不是有效 JSON"); }
    const release = await must(opc<Release>("meta-data", "releases", {method: "POST", body: profile}), "创建发布");
    setCreating(null); setSelectedId(release.id);
    return release.status === "BLOCKED" ? `已创建 ${short(release.id)}，但有 ${release.blockers.length} 个阻塞项` : `已创建 ${short(release.id)}，下一步：检查就绪`;
  });
  const bind = (candidate: BindingCandidate, mode: "bind" | "unbind") => run(async () => {
    const res = await fetch("/api/platform/bindings", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({pageId: candidate.pageId, mode})});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `绑定失败（${res.status}）`);
    return mode === "bind" ? `「${candidate.name}」已绑定当前发布的能力` : `「${candidate.name}」已恢复示例数据`;
  });
  const profileOf = (r: Release) => JSON.stringify({app: r.app, packageRef: r.packageRef, actions: r.actions, bindingIds: r.bindings.map(b => b.id), capabilities: r.capabilities.map(c => c.capabilityRef)}, null, 2);

  return <>
    <div className="catalog-stats">
      <Stat label="当前启用" value={active ? short(active.id, 10) : "无"}/>
      <Stat label="能力" value={String(active?.capabilities.length ?? 0)}/>
      <Stat label="Operation" value={String(active?.operations.length ?? 0)}/>
      <Stat label="已知发布" value={String(releases.length)}/>
    </div>
    <p className="catalog-notice" role="status">{busy ? "处理中…" : notice}</p>
    {error && <div className="bm-alert" role="alert"><ShieldAlert size={14}/><div><strong>{error}</strong></div></div>}

    <div className="platform-split">
      <section className="platform-section">
        <h2>发布清单 <small>meta-data 不提供列表接口，这里列出本机见过的发布</small></h2>
        <div className="table-card"><div className="table-scroll"><table className="platform-table"><caption className="sr-only">发布清单</caption>
          <thead><tr><th>发布</th><th>模型包</th><th>状态</th><th>创建时间</th></tr></thead>
          <tbody>{releases.map(({id, release}) => <tr key={id} data-active={id === selectedId}>
            <td><button className="link" onClick={() => setSelectedId(id)} aria-pressed={id === selectedId}>{short(id, 16)}</button>{id === activeId && <p><span className="platform-chip ok">当前启用</span></p>}</td>
            <td className="platform-mono">{release ? `${release.packageRef.id}@${release.packageRef.version}` : "—"}</td>
            <td>{release ? <span className={`platform-chip ${releaseStatus[release.status].tone}`}>{releaseStatus[release.status].label}</span> : <span className="platform-chip bad">meta-data 中已不存在</span>}</td>
            <td className="date-cell">{time(release?.createdAt)}</td>
          </tr>)}</tbody></table>
          {!releases.length && <Empty>还没有发布。启动 opc-platform 后运行 <code>npm run poc:publish</code>，或在这里按运行方案创建。</Empty>}</div></div>
        <div className="platform-actions"><Button size="sm" variant="outline" disabled={busy || !active} onClick={() => active && setCreating(profileOf(active))}><Plus size={13}/>按运行方案创建发布</Button></div>
      </section>

      <section className="platform-section" aria-label="发布详情">
        {selected ? <ReleaseDetail release={selected} isActive={selected.id === activeId} busy={busy} onPrepare={() => prepare(selected)} onActivate={() => activate(selected)}/>
          : <div className="platform-card"><Empty>选择一个发布查看清单、阻塞项和就绪状态</Empty></div>}
        {diff && <div className="platform-card" aria-label="与当前启用版本对比">
          <header><h3><GitCompare size={14}/> 与当前启用版本对比</h3>{diff.same && <span className="platform-chip ok">内容相同</span>}</header>
          {diff.package && <p className="platform-mono">模型包：{diff.package}</p>}
          {diff.sections.filter(s => s.entries.length).map(s => <div key={s.name}><h4>{s.label}</h4><ul className="platform-list platform-diff">{s.entries.map(e =>
            <li key={e.key} data-change={e.change}><b>{e.change === "added" ? "+ 新增" : e.change === "removed" ? "− 移除" : "~ 变更"}</b><code>{e.key}</code>{e.detail && <small>{e.detail}</small>}</li>)}</ul></div>)}
        </div>}
      </section>
    </div>

    <section className="platform-section" aria-label="页面能力绑定">
      <h2><Link2 size={15}/> 页面能力绑定 <small>Page DSL 0.2.0：列表读查询能力，详情面板提供命令</small></h2>
      <p>把业务原型的列表／详情页面绑定到当前启用发布中的能力：列表数据源改为 <code>capability</code>，详情面板加入 <code>record.command</code>（预览 → 确认 → 回执）。只匹配发布数据映射中出现的业务对象；未连接后端时页面继续使用示例数据。</p>
      <div className="table-card"><div className="table-scroll"><table className="platform-table"><caption className="sr-only">可绑定页面</caption>
        <thead><tr><th>页面</th><th>当前</th><th>建议</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{candidates.map(c => <tr key={c.pageId}>
          <td><div className="resource-name"><div><strong>{c.name}</strong><p>{c.model} · <code>{c.entityId}</code> → <code>{c.objectType}</code></p></div></div></td>
          <td>{c.current.dataSource || c.current.commands.length ? <ul className="platform-list"><li>列表 <code>{c.current.dataSource ?? "示例数据"}</code></li>{c.current.commands.map(ref => <li key={ref}>命令 <code>{ref}</code></li>)}</ul> : <span className="platform-chip">示例数据</span>}
            {c.issues.map((i, k) => <p key={k} className="record-field-error">{i.message}</p>)}</td>
          <td><ul className="platform-list"><li>列表 <code>{c.suggestion.dataSource?.capabilityRef ?? "—"}</code></li>{c.suggestion.commands.map(cmd => <li key={cmd.capabilityRef}>命令 <code>{cmd.capabilityRef}</code>「{cmd.label}」</li>)}
            {c.suggestion.notes.map((n, k) => <li key={k}><small>{n}</small></li>)}</ul></td>
          <td className="catalog-row-actions">
            <Button size="sm" disabled={busy || (!c.suggestion.dataSource && !c.suggestion.commands.length)} onClick={() => void bind(c, "bind")}><Workflow size={13}/>绑定</Button>
            {(c.current.dataSource || c.current.commands.length > 0) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void bind(c, "unbind")}><Unlink size={13}/>解除</Button>}
            <Button asChild size="sm" variant="outline"><a href={c.href}>打开<ArrowUpRight size={13}/></a></Button>
          </td>
        </tr>)}</tbody></table>
        {hidden > 0 && <p className="platform-more"><button className="link" onClick={() => setShowAll(!showAll)}>{showAll ? "只看可绑定的页面" : `另有 ${hidden} 个页面的对象在当前发布中没有能力，显示全部`}</button></p>}
        {!candidates.length && <Empty>没有可绑定的页面。先在「业务建模」导入同名模型（如 campus_library），为发布映射中的对象（如 book_copy）创建页面。</Empty>}</div></div>
    </section>

    <Dialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.description}</DialogDescription>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button disabled={busy} onClick={() => void confirm?.action()}>{busy ? "处理中…" : "确认启用"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={creating !== null} onOpenChange={open => { if (!open && !busy) setCreating(null); }}><DialogContent className="model-editor"><DialogTitle>按运行方案创建发布</DialogTitle>
      <DialogDescription>运行方案（RuntimeProfile）决定发布包含哪些 Action、行为绑定和能力。meta-data 会冻结对应的 Operation 与能力，缺失项成为阻塞项。已用当前启用发布预填。</DialogDescription>
      <textarea className="model-json" aria-label="运行方案 JSON" value={creating ?? ""} onChange={e => setCreating(e.target.value)}/>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setCreating(null)}>取消</Button><Button disabled={busy} onClick={() => creating && void create(creating)}>{busy ? "创建中…" : "创建发布"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

function ReleaseDetail({release, isActive, busy, onPrepare, onActivate}: {release: Release; isActive: boolean; busy: boolean; onPrepare: () => void; onActivate: () => void}) {
  const status = releaseStatus[release.status];
  return <div className="platform-card" aria-label={`发布 ${release.id}`}>
    <header><div><h3>{release.id}</h3><p className="platform-mono">{release.app}</p></div><span className={`platform-chip ${status.tone}`}>{status.label}</span></header>
    <dl className="platform-kv">
      <dt>模型包</dt><dd><code>{release.packageRef.id}@{release.packageRef.version}</code></dd>
      <dt>清单摘要</dt><dd><code title={release.manifestDigest}>{short(release.manifestDigest, 24)}</code></dd>
      <dt>合同版本</dt><dd>{release.contractVersion}</dd>
      <dt>创建 / 启用</dt><dd>{time(release.createdAt)} / {time(release.activatedAt)}</dd>
      <dt>组成</dt><dd>{release.capabilities.length} 能力 · {release.operations.length} Operation · {release.mappings.length} 映射 · {release.bindings.length} 行为绑定</dd>
    </dl>
    <div><h4>阻塞项</h4>{release.blockers.length ? <ul className="platform-list platform-blockers">{release.blockers.map(b => <li key={b}>{b}</li>)}</ul> : <p className="platform-ready"><CheckCircle2 size={12}/> 无</p>}</div>
    <div><h4>就绪状态</h4><ul className="platform-list">{(["db-connect", "bff"] as const).map(service => { const r = release.readiness[service];
      return <li key={service}><code>{service}</code>{r ? <><span className={`platform-chip ${r.ready ? "ok" : "bad"}`}>{r.ready ? "就绪" : "未就绪"}</span><small>{time(r.reportedAt)}</small>{r.blockers.map(b => <small key={b} className="record-field-error">{b}</small>)}</> : <span className="platform-chip">未报告</span>}</li>; })}</ul></div>
    <div><h4>能力</h4><ul className="platform-list">{release.capabilities.map(c => <li key={c.capabilityRef}><code>{c.capabilityRef}</code><span className={`platform-chip ${c.kind === "command" ? "warn" : "info"}`}>{c.kind === "command" ? "命令" : "查询"}</span>
      <small>{c.title} · {c.allowedRoles.join(", ")} · {c.handler.type === "operation" ? `直通 ${c.handler.operationId}` : `脚本 ${c.handler.module}`}</small></li>)}</ul></div>
    <div className="platform-actions">
      <Button size="sm" variant="outline" disabled={busy || release.status === "BLOCKED" || release.status === "SUPERSEDED"} onClick={onPrepare}><CheckCircle2 size={13}/>检查就绪</Button>
      <Button size="sm" disabled={busy || release.status !== "READY"} onClick={onActivate} title={release.status === "READY" ? undefined : "两端都就绪后才能启用"}><Rocket size={13}/>{isActive ? "已启用" : "启用"}</Button>
    </div>
  </div>;
}

function Stat({label, value}: {label: string; value: string}) {
  return <div className="catalog-stat"><span><Rocket size={16}/></span><div><b>{value}</b><small>{label}</small></div></div>;
}
