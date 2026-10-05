"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Boxes, Database, FileStack, Layers3, LayoutTemplate, Link2, PencilRuler, Plus, RefreshCw, Search, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { baseTypeLabels, pageKindLabels, pageKinds, pageRoute, type ObjectType, type PageKind } from "@/ontology/model";
import type { ObjectTypeSummary, PageRecord } from "@/server/ontology-store";
import type { TemplateMeta } from "@/core/templates";
import { ModelEditor } from "./model-editor";

type Props = {objectTypes: ObjectTypeSummary[]; pages: PageRecord[]; templates: TemplateMeta[]; database: string};
type Confirm = {title: string; description: string; action: () => Promise<void>; destructive?: boolean};
const sourceLabels: Record<string, string> = {seed: "初始数据", ontology: "模型生成", composer: "设计器编辑"};

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {method, headers: body ? {"Content-Type": "application/json"} : undefined, body: body ? JSON.stringify(body) : undefined});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `请求失败（${response.status}）`);
  return result;
}

export function ResourceCatalog({objectTypes, pages, templates, database}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ObjectType | "new" | null>(null), [confirm, setConfirm] = useState<Confirm | null>(null);
  const [importing, setImporting] = useState<TemplateMeta | null>(null), [importName, setImportName] = useState("");
  const typeName = useMemo(() => new Map(objectTypes.map(t => [t.type.apiName, t.type.displayName])), [objectTypes]);
  const sample = useMemo(() => new Map(objectTypes.map(t => [t.type.apiName, t.sampleId])), [objectTypes]);
  const records = objectTypes.reduce((sum, t) => sum + t.count, 0);
  const q = query.trim().toLowerCase();
  const visibleTypes = objectTypes.filter(t => !q || [t.type.displayName, t.type.apiName, t.type.description].join(" ").toLowerCase().includes(q));
  const visiblePages = pages.filter(p => !q || [p.name, p.objectType, typeName.get(p.objectType) ?? ""].join(" ").toLowerCase().includes(q));
  const visibleTemplates = templates.filter(t => !q || [t.name, t.id, t.description, ...t.tags].join(" ").toLowerCase().includes(q));

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true); setNotice("");
    try { await action(); setNotice(success); router.refresh(); }
    catch (error) { setNotice(`操作失败：${error instanceof Error ? error.message : "请重试"}`); }
    finally { setBusy(false); setConfirm(null); }
  }
  const openUrl = (page: PageRecord) => page.kind === "detail" ? (sample.get(page.objectType) ? pageRoute(page.objectType, "detail", sample.get(page.objectType)) : null) : pageRoute(page.objectType, page.kind);
  const generate = (apiName: string, kinds: PageKind[], overwrite = false) => run(() => call("/api/pages", "POST", {objectType: apiName, kinds, overwrite}), overwrite ? "页面已按当前模型重新生成" : "已生成缺失页面");

  return <div className="catalog-app">
    <header className="catalog-topbar">
      <Link className="catalog-brand" href="/"><span className="app-logo"><Layers3 size={17}/></span><strong>Composer</strong></Link>
      <nav aria-label="主导航"><Link href="/">页面设计器</Link><Link className="active" href="/resources" aria-current="page">资源清单</Link><Link href="/apps">业务原型</Link></nav>
      <span className="catalog-db" title="SQLite 数据库文件"><Database size={13}/>{database}</span>
    </header>
    <main className="catalog-main">
      <section className="catalog-hero">
        <div><span className="page-eyebrow"><Boxes size={14}/> ONTOLOGY · SQLITE</span><h1>资源清单</h1>
          <p>以数据模型（对象类型、属性、关联）为中心管理原型资源。每个模型可一键生成「列表 + 详情」「独立详情」「新建 / 编辑」页面，组合成可运行的业务系统原型。</p></div>
        <div className="catalog-hero-actions"><Button onClick={() => setEditing("new")}><Plus size={14}/>新建数据模型</Button><Button asChild variant="outline"><Link href="/apps">打开业务原型<ArrowUpRight size={14}/></Link></Button></div>
      </section>
      <div className="catalog-stats">
        <Stat icon={<Boxes size={16}/>} label="数据模型" value={objectTypes.length}/><Stat icon={<FileStack size={16}/>} label="页面" value={pages.length}/>
        <Stat icon={<Database size={16}/>} label="业务记录" value={records}/><Stat icon={<LayoutTemplate size={16}/>} label="页面模板" value={templates.length}/>
      </div>
      <Tabs defaultValue="models" className="catalog-tabs">
        <div className="catalog-toolbar"><TabsList><TabsTrigger value="models">数据模型</TabsTrigger><TabsTrigger value="pages">页面</TabsTrigger><TabsTrigger value="templates">模板</TabsTrigger></TabsList>
          <label className="catalog-search"><Search size={14}/><span className="sr-only">搜索资源</span><input value={query} placeholder="搜索名称、ID 或描述…" onChange={e => setQuery(e.target.value)}/></label></div>
        <p className="catalog-notice" role="status">{busy ? "处理中…" : notice}</p>

        <TabsContent value="models" className="model-grid">
          {visibleTypes.map(({type, count, pages: typePages}) => {
            const links = type.properties.filter(p => p.baseType === "link");
            const missing = pageKinds.filter(kind => !typePages.some(p => p.kind === kind));
            return <article className="model-card" key={type.apiName}>
              <header><div><h2>{type.displayName}</h2><code>{type.apiName}</code></div><Badge variant="secondary">{count} 条记录</Badge></header>
              <p className="model-description">{type.description || "暂无描述"}</p>
              <ul className="model-properties" aria-label="属性">{type.properties.map(p => <li key={p.apiName} title={p.apiName}>
                {p.apiName === type.primaryKey && <span className="pk">PK</span>}{p.displayName}<small>{baseTypeLabels[p.baseType]}{p.required ? " · 必填" : ""}</small></li>)}</ul>
              {links.length > 0 && <p className="model-links"><Link2 size={12}/>{links.map(l => `${l.displayName} → ${typeName.get(l.target!) ?? l.target}`).join("；")}</p>}
              <div className="model-pages">{pageKinds.map(kind => { const page = typePages.find(p => p.kind === kind), url = page && openUrl(page);
                return page && url ? <a key={kind} href={url} className="page-chip">{pageKindLabels[kind]}<ArrowUpRight size={11}/></a> : <span key={kind} className="page-chip missing">{pageKindLabels[kind]}{page ? "（无记录）" : "（未生成）"}</span>; })}</div>
              <footer>
                {missing.length > 0 && <Button size="sm" disabled={busy} onClick={() => generate(type.apiName, missing)}><Wand2 size={13}/>生成页面</Button>}
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(type)}><PencilRuler size={13}/>编辑模型</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm({title: `重新生成「${type.displayName}」的页面`, description: "按当前模型覆盖三类页面。设计器中对列表页的修改会被替换，业务记录不受影响。", action: () => generate(type.apiName, [...pageKinds], true)})}><RefreshCw size={13}/>重新生成</Button>
                <Button size="sm" variant="ghost" className="danger" disabled={busy} onClick={() => setConfirm({title: `删除数据模型「${type.displayName}」`, description: `将删除该模型、${count} 条记录及其页面，且无法撤销。`, destructive: true, action: () => run(() => call(`/api/ontology/${type.apiName}`, "DELETE"), `已删除「${type.displayName}」`)})}><Trash2 size={13}/>删除</Button>
              </footer>
            </article>;
          })}
          {!visibleTypes.length && <Empty text={objectTypes.length ? "没有匹配的数据模型" : "还没有数据模型，点击「新建数据模型」或从模板导入。"}/>}
        </TabsContent>

        <TabsContent value="pages">
          <div className="table-card"><div className="table-scroll"><table><caption className="sr-only">页面清单</caption>
            <thead><tr><th>页面</th><th>类型</th><th>数据模型</th><th>来源</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{visiblePages.map(page => { const url = openUrl(page); return <tr key={page.id}>
              <td><div className="resource-name"><div><strong>{page.name}</strong><p>{url ?? "需要至少一条记录"}</p></div></div></td>
              <td><span className="type-badge">{pageKindLabels[page.kind]}</span></td><td>{typeName.get(page.objectType)}</td>
              <td>{sourceLabels[page.source] ?? page.source}</td><td className="date-cell">{page.updatedAt.slice(0, 16).replace("T", " ")}</td>
              <td className="catalog-row-actions">{url && <Button asChild size="sm" variant="outline"><a href={url}>打开</a></Button>}
                {page.kind === "list-detail" && <Button asChild size="sm" variant="outline"><a href={`/?page=${encodeURIComponent(page.id)}`}><PencilRuler size={13}/>设计器</a></Button>}
                <Button size="sm" variant="ghost" className="danger" aria-label={`删除 ${page.name}`} disabled={busy} onClick={() => setConfirm({title: `删除页面「${page.name}」`, description: "页面会从清单和业务原型中移除；数据模型和记录保留，可随时重新生成。", destructive: true, action: () => run(() => call(`/api/pages/${page.id}`, "DELETE"), "页面已删除")})}><Trash2 size={13}/></Button></td>
            </tr>; })}</tbody></table>
            {!visiblePages.length && <Empty text="没有页面"/>}</div></div>
        </TabsContent>

        <TabsContent value="templates">
          <div className="table-card"><div className="table-scroll"><table><caption className="sr-only">模板清单</caption>
            <thead><tr><th>模板</th><th>标签</th><th>来源</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{visibleTemplates.map(t => <tr key={t.id}>
              <td><div className="resource-name"><div><strong>{t.name}</strong><p>{t.description || t.id}</p></div></div></td>
              <td>{t.tags.map(tag => <span key={tag} className="type-badge catalog-tag">{tag}</span>)}</td><td>{t.source}</td>
              <td className="catalog-row-actions"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setImporting(t); setImportName(t.id.replace(/[^a-z0-9-]/g, "").replace(/^[^a-z]+/, "") || "model"); }}><Boxes size={13}/>导入为数据模型</Button></td>
            </tr>)}</tbody></table>
            {!visibleTemplates.length && <Empty text="没有模板"/>}</div></div>
        </TabsContent>
      </Tabs>
    </main>

    {editing && <ModelEditor initial={editing === "new" ? null : editing} types={objectTypes.map(t => t.type)} onClose={() => setEditing(null)} onSaved={type => { setEditing(null); setNotice(`已保存数据模型「${type.displayName}」，页面已生成`); router.refresh(); }}/>}
    <Dialog open={!!confirm} onOpenChange={open => { if (!open && !busy) setConfirm(null); }}><DialogContent><DialogTitle>{confirm?.title}</DialogTitle><DialogDescription>{confirm?.description}</DialogDescription>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button variant={confirm?.destructive ? "destructive" : "default"} disabled={busy} onClick={() => void confirm?.action()}>{busy ? "处理中…" : "确认"}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!importing} onOpenChange={open => { if (!open) setImporting(null); }}><DialogContent><DialogTitle>导入模板为数据模型</DialogTitle>
      <DialogDescription>把「{importing?.name}」的字段转换为对象类型属性，示例数据写入 SQLite，并生成三类页面。</DialogDescription>
      <label className="model-field">类型 ID<input value={importName} onChange={e => setImportName(e.target.value)} placeholder="例如 order"/><small>小写字母、数字和连字符，作为页面路由 /apps/&lt;ID&gt;</small></label>
      <DialogFooter><Button variant="outline" onClick={() => setImporting(null)}>取消</Button><Button disabled={busy || !importName} onClick={() => { const t = importing!; setImporting(null); void run(() => call("/api/ontology/from-template", "POST", {templateId: t.id, apiName: importName}), `已从「${t.name}」创建数据模型`); }}>导入</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
}

function Stat({icon, label, value}: {icon: React.ReactNode; label: string; value: number}) {
  return <div className="catalog-stat"><span>{icon}</span><div><b>{value}</b><small>{label}</small></div></div>;
}
function Empty({text}: {text: string}) {
  return <div className="table-empty"><Search size={22}/><span>{text}</span></div>;
}
