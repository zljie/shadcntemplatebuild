"use client";
import { useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { displayValue, type DataRecord } from "./data";
import { useRuntime } from "./components";
import { formBindings, newIdempotencyKey, resolveArguments, statusLabels, valueAt, type CapabilityResult, type CommandAction } from "./opc";

/**
 * Business commands of the selected record (Page DSL 0.2.0 `record.command`). With `confirm` the flow is
 * PREVIEW → confirm → EXECUTE → receipt; EXECUTE always carries one Idempotency-Key per intent, so a retry
 * after a timeout or PENDING returns the original outcome instead of writing twice.
 */
export function CapabilityCommands({commands}: {commands: CommandAction[]}) {
  const {selected, adapter} = useRuntime();
  const [open, setOpen] = useState<CommandAction | null>(null);
  if (!selected || !commands.length) return null;
  const client = adapter?.capability;
  return <div className="command-bar">
    {commands.map(command => <Button key={command.label} variant="default" className="command-button" disabled={!client} title={client ? command.capabilityRef : "连接 BFF 后可执行业务命令"} onClick={() => setOpen(command)}>{command.label}</Button>)}
    {!client && <p className="command-hint">业务命令需要连接 opc-platform BFF；当前为示例数据。</p>}
    {open && client && <CommandDialog key={`${open.label}:${selected.id}`} command={open} row={selected} close={() => setOpen(null)}/>}
  </div>;
}

type Step = {name: "input"} | {name: "busy"; text: string} | {name: "confirm"; preview: CapabilityResult} | {name: "outcome"; result: CapabilityResult} | {name: "error"; message: string};

function CommandDialog({command, row, close}: {command: CommandAction; row: DataRecord; close: () => void}) {
  const {config, adapter, notify, refresh} = useRuntime();
  const client = adapter!.capability!;
  const id = useId();
  const fields = formBindings(command);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, f.field ? String(row[f.field] ?? "") : ""])));
  const [step, setStep] = useState<Step>({name: "input"});
  const [missing, setMissing] = useState<string[]>([]);
  const key = useRef<string | null>(null);
  const busy = step.name === "busy";
  const title = displayValue(config, config.titleField, row[config.titleField]);

  const resolve = () => { const resolved = resolveArguments(command, row, values); setMissing(resolved.missing); return resolved.missing.length ? null : resolved.input; };
  const fail = (error: unknown) => setStep({name: "error", message: error instanceof Error ? error.message : "请求失败"});
  async function preview() {
    const input = resolve(); if (!input) return;
    setStep({name: "busy", text: "正在预览…"});
    try {
      const result = await client.execute(command.capabilityRef, input, {phase: "PREVIEW"});
      setStep(result.status === "SUCCEEDED" ? {name: "confirm", preview: result} : {name: "outcome", result});
    } catch (error) { fail(error); }
  }
  async function execute() {
    const input = resolve(); if (!input) return;
    key.current ??= newIdempotencyKey();
    setStep({name: "busy", text: "正在执行…"});
    try { finish(await client.execute(command.capabilityRef, input, {phase: "EXECUTE", idempotencyKey: key.current})); }
    catch (error) { fail(error); }
  }
  async function lookup(requestId: string) {
    setStep({name: "busy", text: "正在查询执行结果…"});
    try { const result = await client.execution(requestId); if (result) finish(result); else setStep({name: "error", message: "还没有执行记录，请稍后再查"}); }
    catch (error) { fail(error); }
  }
  function finish(result: CapabilityResult) {
    setStep({name: "outcome", result});
    if (result.status === "SUCCEEDED") {
      notify(command.result.onSuccess.notice ?? `${command.label}成功：${title}`);
      if (command.result.onSuccess.refresh) refresh();
    } else if (result.status === "REJECTED") notify(command.result.onRejected.notice ?? `${command.label}未通过：${result.reasons[0]?.message ?? "业务规则拒绝"}`);
  }
  const edit = (k: string, v: string) => { setValues(current => ({...current, [k]: v})); key.current = null; };

  return <Dialog open onOpenChange={next => { if (!next && !busy) close(); }}>
    <DialogContent className="runtime-detail-dialog runtime-form-dialog command-dialog" showCloseButton={false} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>{command.label}</DialogTitle>
      <DialogDescription>{title} · <code>{command.capabilityRef}</code>{command.confirm ? " · 预览 → 确认 → 回执" : ""}</DialogDescription>
      <button className="record-form-close" aria-label="关闭" disabled={busy} onClick={close}><X size={16}/></button>
      <ol className="command-steps" aria-label="办理步骤">{(command.confirm ? ["填写", "预览确认", "回执"] : ["填写", "回执"]).map((label, i) => {
        const at = step.name === "confirm" ? 1 : step.name === "outcome" ? (command.confirm ? 2 : 1) : 0;
        return <li key={label} data-state={i < at ? "done" : i === at ? "current" : "todo"}>{label}</li>;
      })}</ol>

      {(step.name === "input" || step.name === "busy" || step.name === "error") && <form noValidate onSubmit={event => { event.preventDefault(); void (command.confirm ? preview() : execute()); }}>
        <dl className="command-bound">{Object.entries(command.arguments).map(([k, b]) => b.from === "form" ? null : <div key={k}><dt>{k}</dt><dd>{b.from === "row" ? String(b.field === "id" ? row.id : row[b.field] ?? "") : String(b.value)}</dd></div>)}</dl>
        {fields.map(f => <div className="record-form-field" key={f.key}><label htmlFor={`${id}-${f.key}`}>{f.label}{f.required && <span aria-hidden="true"> *</span>}</label>
          <Input id={`${id}-${f.key}`} name={f.key} type={f.type === "number" ? "number" : "text"} value={values[f.key]} disabled={busy} required={f.required} aria-invalid={missing.includes(f.label)} onChange={event => edit(f.key, event.target.value)}/></div>)}
        <p className="record-form-message" role={missing.length || step.name === "error" ? "alert" : "status"}>{busy ? step.text : missing.length ? `请填写：${missing.join("、")}` : step.name === "error" ? step.message : ""}</p>
        <div className="record-form-actions"><Button type="button" variant="outline" disabled={busy} onClick={close}>取消</Button><Button type="submit" disabled={busy}>{command.confirm ? "预览" : "执行"}</Button></div>
      </form>}

      {step.name === "confirm" && <>
        <ResultView result={step.preview} command={command}/>
        <div className="record-form-actions"><Button variant="outline" onClick={() => setStep({name: "input"})}>返回修改</Button><Button onClick={() => void execute()}>确认{command.label}</Button></div>
      </>}

      {step.name === "outcome" && <>
        <ResultView result={step.result} command={command}/>
        <div className="record-form-actions">
          {step.result.status === "PENDING" && <Button variant="outline" onClick={() => void lookup(step.result.requestId)}>查询结果</Button>}
          {step.result.status === "FAILED" && step.result.phase === "EXECUTE" && <Button variant="outline" onClick={() => void execute()}>重试（同一幂等键）</Button>}
          {step.result.status !== "SUCCEEDED" && <Button variant="outline" onClick={() => { key.current = null; setStep({name: "input"}); }}>返回修改</Button>}
          <Button onClick={close}>完成</Button>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}

function ResultView({result, command}: {result: CapabilityResult; command: CommandAction}) {
  const receipt = command.result.onSuccess.receipt ?? [];
  const shown = receipt.filter(r => valueAt(result.data, r.key) !== undefined);
  return <section className="command-result" data-status={result.status} aria-live="polite">
    <header><span className={`command-status status-${result.status.toLowerCase()}`}>{result.phase === "PREVIEW" ? "预览" : "执行"}{statusLabels[result.status]}</span><code>{result.requestId}</code></header>
    {result.reasons.length > 0 && <ul className="command-reasons">{result.reasons.map((r, i) => <li key={i}><strong>{r.message}</strong><small>{r.code}{r.ruleId ? ` · ${r.ruleId}` : ""}</small></li>)}</ul>}
    {result.status === "SUCCEEDED" && (shown.length ? <dl className="command-receipt">{shown.map(r => <div key={r.key}><dt>{r.label}</dt><dd>{String(valueAt(result.data, r.key) ?? "—")}</dd></div>)}</dl>
      : result.data !== null && result.data !== undefined && <pre className="command-data">{JSON.stringify(result.data, null, 2)}</pre>)}
    {result.status === "PENDING" && <p className="command-hint">请求已受理，结果尚未确定。用同一请求号查询，不会重复办理。</p>}
  </section>;
}
