"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Download, FileUp, Network, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { TopNav } from "@/prototype/top-nav";
import type { BusinessModelSummary } from "@/server/business-model-store";
import { viewLabels } from "./model";

type ImportError = {message: string; issues: {path: string; message: string}[]};

export function BusinessModelList({models}: {models: BusinessModelSummary[]}) {
  const router = useRouter(), input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState<ImportError | null>(null);
  const [removing, setRemoving] = useState<BusinessModelSummary | null>(null);

  async function upload(file: File) {
    setBusy(true); setNotice(""); setError(null);
    try {
      const response = await fetch("/api/business-models", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({yaml: await file.text(), fileName: file.name})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError({message: result.error ?? `导入失败（${response.status}）`, issues: result.errors ?? []}); return; }
      router.push(`/business-models/${encodeURIComponent(result.model.id)}`);
    } catch (e) { setError({message: e instanceof Error ? e.message : "导入失败", issues: []}); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }
  async function remove(model: BusinessModelSummary) {
    setBusy(true);
    const response = await fetch(`/api/business-models/${encodeURIComponent(model.id)}`, {method: "DELETE"});
    setBusy(false); setRemoving(null);
    setNotice(response.ok ? `已删除「${model.name}」` : "删除失败");
    router.refresh();
  }

  return <div className="catalog-app">
    <TopNav active="/business-models"/>
    <main className="catalog-main">
      <section className="catalog-hero">
        <div><span className="page-eyebrow"><Network size={14}/> BUSINESS MODEL · BMF-001</span><h1>业务建模</h1>
          <p>上传本体 YAML（semantic_model），按对象、关系、行为、规则、角色、状态、事件和指标视角管理业务模型，校验引用并记录完成度，再把业务对象投影为应用页面。</p></div>
        <div className="catalog-hero-actions">
          <input ref={input} type="file" accept=".yaml,.yml,application/yaml,text/yaml" className="sr-only" aria-label="选择 YAML 文件" data-testid="yaml-upload"
            onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); }}/>
          <Button disabled={busy} onClick={() => input.current?.click()}><FileUp size={14}/>{busy ? "导入中…" : "上传 YAML"}</Button>
        </div>
      </section>
      <p className="catalog-notice" role="status">{notice}</p>
      {error && <div className="bm-alert" role="alert"><AlertTriangle size={14}/><div><strong>{error.message}</strong>
        {error.issues.length > 0 && <ul>{error.issues.slice(0, 8).map((issue, i) => <li key={i}><code>{issue.path || "(root)"}</code> {issue.message}</li>)}</ul>}</div></div>}

      <div className="model-grid">
        {models.map(model => <article className="model-card" key={model.id}>
          <header><div><h2><Link href={`/business-models/${encodeURIComponent(model.id)}`}>{model.name}</Link></h2><code>{model.fileName} · v{model.sourceVersion || "?"}</code></div>
            {model.errors > 0 ? <Badge variant="destructive">{model.errors} 个错误</Badge> : <Badge variant="secondary">{model.warnings} 个提醒</Badge>}</header>
          <p className="model-description">{model.description || "暂无描述"}</p>
          <ul className="model-properties" aria-label="视角数量">
            {(["entity", "relationship", "action", "rule", "role", "metric"] as const).map(view => <li key={view}>{viewLabels[view]}<small>{model.counts[view]}</small></li>)}
            <li>字段<small>{model.counts.fields}</small></li>
          </ul>
          <footer>
            <Button asChild size="sm"><Link href={`/business-models/${encodeURIComponent(model.id)}`}>打开<ArrowUpRight size={13}/></Link></Button>
            <Button asChild size="sm" variant="outline"><a href={`/api/business-models/${encodeURIComponent(model.id)}/export`}><Download size={13}/>导出 YAML</a></Button>
            <Button size="sm" variant="ghost" className="danger" disabled={busy} onClick={() => setRemoving(model)}><Trash2 size={13}/>删除</Button>
            <span className="date-cell bm-updated">{model.updatedAt.slice(0, 16).replace("T", " ")}</span>
          </footer>
        </article>)}
        {!models.length && <button type="button" className="bm-dropzone" disabled={busy} onClick={() => input.current?.click()}>
          <FileUp size={22}/><strong>还没有业务模型</strong><span>上传一个本体 YAML，例如 docs/business-model/campus_library.yaml</span></button>}
      </div>
    </main>
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !busy) setRemoving(null); }}><DialogContent>
      <DialogTitle>删除业务模型「{removing?.name}」</DialogTitle>
      <DialogDescription>模型及其编辑记录将被删除；已生成的数据模型和页面保留在资源清单中。</DialogDescription>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>取消</Button><Button variant="destructive" disabled={busy} onClick={() => removing && void remove(removing)}>删除</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}
