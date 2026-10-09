"use client";
import { useMemo, useState } from "react";
import { FlaskConical, History, Play, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newIdempotencyKey, statusLabels, type CapabilityResult } from "@/runtime/opc";
import type { Capability } from "@/server/opc-platform";
import { devIdentities, errorText, opc, type DevIdentity } from "./api";
import { Empty } from "./frame";
import { formToInput, schemaFields } from "./schema-form";

const graphqlQuery = "query Run($ref: ID!, $input: JSON) { capability(ref: $ref, input: $input) { requestId traceId releaseId capabilityRef phase status data reasons { code message ruleId } evidenceRefs } }";
type Run = {at: string; via: "REST" | "GraphQL" | "执行记录"; identity: string; httpStatus: number; result: CapabilityResult | null; error?: string};

/** Pick a published capability, fill its input from the JSON Schema, choose a development identity, then preview / execute against the BFF. */
export function CapabilityRunner({capabilities, releaseId}: {capabilities: Capability[]; releaseId: string | null}) {
  const [ref, setRef] = useState(capabilities[0]?.capabilityRef ?? "");
  const capability = capabilities.find(c => c.capabilityRef === ref);
  const fields = useMemo(() => schemaFields(capability?.inputSchema), [capability]);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [identityIndex, setIdentityIndex] = useState(0), [custom, setCustom] = useState<DevIdentity>({actor: "", roles: ""});
  const [key, setKey] = useState(newIdempotencyKey), [errors, setErrors] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Run[]>([]), [busy, setBusy] = useState(false);
  const current = values[ref] ?? {};
  const identity = identityIndex === devIdentities.length ? custom : devIdentities[identityIndex].identity;
  const identityLabel = identityIndex === devIdentities.length ? `${custom.actor || "?"} · ${custom.roles || "无角色"}` : devIdentities[identityIndex].label;

  async function send(via: Run["via"], call: () => Promise<{ok: boolean; status: number; body: unknown}>, pick: (body: unknown) => CapabilityResult | null) {
    setBusy(true);
    try {
      const res = await call(), result = pick(res.body);
      setRuns(list => [{at: new Date().toISOString(), via, identity: identityLabel, httpStatus: res.status, result, ...(result ? {} : {error: errorText(res.body, res.status)})}, ...list].slice(0, 8));
    } catch (e) {
      setRuns(list => [{at: new Date().toISOString(), via, identity: identityLabel, httpStatus: 0, result: null, error: e instanceof Error ? e.message : String(e)}, ...list].slice(0, 8));
    } finally { setBusy(false); }
  }
  const asResult = (body: unknown) => (body && typeof body === "object" && "status" in body && "reasons" in body ? body as CapabilityResult : null);
  function input() { const {input, errors} = formToInput(fields, current); setErrors(errors); return Object.keys(errors).length ? null : input; }
  const execute = (phase: "PREVIEW" | "EXECUTE") => { const body = input(); if (!body) return;
    void send("REST", () => opc("bff", `api/v1/capabilities/${ref}/execute`, {method: "POST", body: {phase, input: body}, identity, idempotencyKey: capability?.kind === "command" && phase === "EXECUTE" ? key : undefined}), asResult); };
  const viaGraphql = () => { const body = input(); if (!body) return;
    void send("GraphQL", () => opc("bff", "graphql", {method: "POST", body: {query: graphqlQuery, variables: {ref, input: body}}, identity}),
      b => (b as {data?: {capability?: CapabilityResult}} | null)?.data?.capability ?? null); };
  const lookup = (requestId: string) => void send("执行记录", () => opc("bff", `api/v1/executions/${encodeURIComponent(requestId)}`, {identity}), asResult);

  if (!capabilities.length) return <div className="platform-card"><Empty>当前没有已启用的发布或能力</Empty></div>;
  return <div className="platform-split">
    <div className="platform-section">
      <div className="table-card"><div className="table-scroll"><table className="platform-table"><caption className="sr-only">已发布能力</caption>
        <thead><tr><th>能力</th><th>类型</th><th>角色</th></tr></thead>
        <tbody>{capabilities.map(c => <tr key={c.capabilityRef} data-active={c.capabilityRef === ref}>
          <td><button className="link" onClick={() => { setRef(c.capabilityRef); setErrors({}); }} aria-pressed={c.capabilityRef === ref}>{c.capabilityRef}</button><p>{c.title}</p></td>
          <td><span className={`platform-chip ${c.kind === "command" ? "warn" : "info"}`}>{c.kind === "command" ? "命令" : "查询"}</span><p className="platform-mono">{c.handler.type === "operation" ? "直通" : "脚本"}</p></td>
          <td>{c.allowedRoles.map(r => <span key={r} className="type-badge catalog-tag">{r}</span>)}</td>
        </tr>)}</tbody></table></div></div>
      {runs.length > 0 && <div className="platform-card" aria-label="最近调用"><h3><History size={14}/> 最近调用</h3>
        <ul className="platform-list">{runs.slice(1).map((r, i) => <li key={i}><span className={`command-status status-${(r.result?.status ?? "failed").toLowerCase()}`}>{r.result ? statusLabels[r.result.status] : `HTTP ${r.httpStatus}`}</span>
          <code>{r.result?.capabilityRef ?? ref}</code><small>{r.via} · {r.result?.phase ?? ""} · {r.identity} · {r.at.slice(11, 19)}</small></li>)}</ul></div>}
    </div>

    <div className="platform-section">
      {capability && <form className="platform-card platform-form" aria-label={`试运行 ${capability.capabilityRef}`} onSubmit={e => { e.preventDefault(); execute("EXECUTE"); }}>
        <header><div><h3><FlaskConical size={14}/> {capability.capabilityRef}</h3><p className="platform-mono">{capability.title} · 发布 {releaseId}</p></div></header>
        <label className="model-field">身份（开发期 x-opc-* 头）<select value={identityIndex} onChange={e => setIdentityIndex(Number(e.target.value))}>
          {devIdentities.map((d, i) => <option key={d.label} value={i}>{d.label}</option>)}<option value={devIdentities.length}>自定义…</option></select></label>
        {identityIndex === devIdentities.length && <div className="model-grid-2">
          <label className="model-field">actor<input value={custom.actor} onChange={e => setCustom({...custom, actor: e.target.value})} placeholder="u_librarian"/></label>
          <label className="model-field">roles<input value={custom.roles} onChange={e => setCustom({...custom, roles: e.target.value})} placeholder="LIBRARIAN,READER"/></label></div>}
        {fields.length ? fields.map(f => <label key={f.key} className="model-field"><span className="platform-field-name">{f.key}{f.required && <span aria-hidden="true">*</span>}</span>
          {f.kind === "enum" || f.kind === "boolean" ? <select name={f.key} value={current[f.key] ?? ""} onChange={e => setValues({...values, [ref]: {...current, [f.key]: e.target.value}})}>
            <option value="">（不填）</option>{(f.kind === "boolean" ? ["true", "false"] : f.options!).map(o => <option key={o}>{o}</option>)}</select>
            : <input name={f.key} value={current[f.key] ?? ""} inputMode={f.kind === "integer" || f.kind === "number" ? "numeric" : undefined} aria-invalid={!!errors[f.key]}
              placeholder={[f.kind, f.nullable ? "可为空" : "", f.minimum !== undefined ? `≥${f.minimum}` : "", f.maximum !== undefined ? `≤${f.maximum}` : ""].filter(Boolean).join(" · ")}
              onChange={e => setValues({...values, [ref]: {...current, [f.key]: e.target.value}})}/>}
          {errors[f.key] && <small className="record-field-error">{errors[f.key]}</small>}</label>) : <p className="platform-mono">此能力没有输入</p>}
        {capability.kind === "command" && <label className="model-field">Idempotency-Key<span className="platform-actions"><input value={key} onChange={e => setKey(e.target.value)} style={{flex: 1}}/>
          <Button type="button" size="sm" variant="ghost" onClick={() => setKey(newIdempotencyKey())}><RefreshCw size={13}/>换一个</Button></span>
          <small>同一个键重复执行返回原结果，不会重复写入</small></label>}
        <div className="platform-actions">
          {capability.kind === "command" && <Button type="button" variant="outline" disabled={busy} onClick={() => execute("PREVIEW")}><ScanSearch size={13}/>预览</Button>}
          <Button type="submit" disabled={busy}><Play size={13}/>{busy ? "调用中…" : "执行"}</Button>
          {capability.kind === "query" && <Button type="button" variant="outline" disabled={busy} onClick={viaGraphql}>用 GraphQL 读取</Button>}
        </div>
      </form>}
      {runs[0] && <RunView run={runs[0]} onLookup={lookup} busy={busy}/>}
    </div>
  </div>;
}

function RunView({run, onLookup, busy}: {run: Run; onLookup: (requestId: string) => void; busy: boolean}) {
  const r = run.result;
  return <section className="platform-card platform-result" data-status={r?.status ?? "FAILED"} aria-label="调用结果" aria-live="polite">
    <header><div><h3>{r ? <span className={`command-status status-${r.status.toLowerCase()}`}>{r.phase === "PREVIEW" ? "预览" : "执行"} · {r.status}</span> : <span className="command-status status-failed">HTTP {run.httpStatus}</span>}</h3>
      <p className="platform-mono">{run.via} · {run.identity}</p></div>
      {r?.requestId && r.phase === "EXECUTE" && <Button size="sm" variant="outline" disabled={busy} onClick={() => onLookup(r.requestId)}>查询执行记录</Button>}</header>
    {run.error && <p className="record-field-error">{run.error}</p>}
    {r && <>
      <dl className="platform-kv"><dt>requestId</dt><dd><code>{r.requestId || "—"}</code></dd><dt>traceId</dt><dd><code>{r.traceId || "—"}</code></dd><dt>release</dt><dd><code>{r.releaseId}</code></dd>{r.evidenceRefs.length > 0 && <><dt>证据</dt><dd><code>{r.evidenceRefs.join(", ")}</code></dd></>}</dl>
      {r.reasons.length > 0 && <div><h4>原因</h4><ul className="command-reasons">{r.reasons.map((x, i) => <li key={i}><strong>{x.message}</strong><small>{x.code}{x.ruleId ? ` · ${x.ruleId}` : ""}</small></li>)}</ul></div>}
      <div><h4>data</h4><pre className="platform-json">{JSON.stringify(r.data, null, 2)}</pre></div>
    </>}
  </section>;
}
