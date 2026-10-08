"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ContextualShell, RecordFormBody, RuntimeProvider, WorkspacePane, useRecordForm, type RecordAdapter } from "@/runtime/components";
import { displayValue, type DataRecord, type ListDetail } from "@/runtime/data";
import { manifest } from "./modules";
import { href, navigation, STORE_LABEL, useModuleData } from "./app";
import { moduleByKey, NONE, repository, withLinks } from "./repository";

function Shell({module, config, record, children}: {module: string; config: ListDetail; record?: DataRecord; children: React.ReactNode}) {
  const [adapter] = useState<RecordAdapter>(() => ({label: STORE_LABEL, submit: request => repository.submit(module, request)}));
  return <RuntimeProvider listDetail={config} pageTitle={moduleByKey(module).title} adapter={adapter} navigation={navigation(module)} initialSelectedId={record?.id ?? null}>
    <ContextualShell workspaceName={manifest.workspaceName}><WorkspacePane>{children}</WorkspacePane></ContextualShell>
  </RuntimeProvider>;
}

export function RecordDetailPage({module, id}: {module: string; id: string}) {
  const {data, loaded} = useModuleData(module);
  const target = moduleByKey(module), config = {...withLinks(target, data), rows: data[module]};
  const record = data[module].find(row => row.id === id);
  if (!record) return <Shell module={module} config={config}><p className="record-page">{loaded ? "记录不存在。" : "加载中…"}</p></Shell>;
  return <Shell module={module} config={config} record={record}><RecordDetail module={module} config={config} record={record}/></Shell>;
}

function RecordDetail({module, config, record}: {module: string; config: ListDetail; record: DataRecord}) {
  const router = useRouter(), target = moduleByKey(module);
  const [confirm, setConfirm] = useState(false), [deleting, setDeleting] = useState(false);
  const title = displayValue(config, config.titleField, record[config.titleField]);
  const fields = config.fields.filter(f => f.key !== config.titleField && f.key !== config.descriptionField);
  const incoming = manifest.modules.flatMap(m => Object.entries(m.links).filter(([, to]) => to === module).map(([field]) => ({module: m, field})));
  async function remove() {
    setDeleting(true);
    await repository.remove(module, record.id);
    router.push(href(module));
  }
  return <article className="record-page">
    <a className="record-back" href={href(module)}><ArrowLeft size={14}/>返回{target.title}</a>
    <header className="record-page-header">
      <div><span className="page-eyebrow">{config.entityName} · {STORE_LABEL}</span><h1>{title}</h1>{config.descriptionField && <p>{String(record[config.descriptionField])}</p>}</div>
      <div className="record-page-actions">
        <Button asChild variant="outline"><a href={href(module, record.id, "/edit")}><Pencil size={14}/>编辑</a></Button>
        <Button variant="outline" className="record-delete" onClick={() => setConfirm(true)}><Trash2 size={14}/>删除</Button>
      </div>
    </header>
    <Card className="runtime-card"><CardHeader><CardTitle>基本信息</CardTitle></CardHeader><CardContent>
      <dl className="record-fields">{fields.map(field => {
        const value = record[field.key], link = target.links[field.key];
        return <div key={field.key}><dt>{field.label}</dt><dd>{link && value !== NONE && value !== ""
          ? <a href={href(link, String(value))}><Link2 size={12}/>{displayValue(config, field.key, value)}</a>
          : displayValue(config, field.key, value) || "—"}</dd></div>;
      })}</dl>
    </CardContent></Card>
    {incoming.map(({module: source, field}) => <IncomingLinks key={`${source.key}-${field}`} source={source.key} field={field} id={record.id}/>)}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogTitle>删除{config.entityName}</DialogTitle>
      <DialogDescription>将删除「{title}」。关联到它的记录会显示为未设置。</DialogDescription>
      <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setConfirm(false)}>取消</Button><Button variant="destructive" disabled={deleting} onClick={() => void remove()}>{deleting ? "删除中…" : "确认删除"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </article>;
}

function IncomingLinks({source, field, id}: {source: string; field: string; id: string}) {
  const {data} = useModuleData(source), owner = moduleByKey(source);
  const rows = data[source].filter(row => row[field] === id);
  if (!rows.length) return null;
  const label = owner.config.fields.find(f => f.key === field)?.label ?? field;
  return <Card className="runtime-card"><CardHeader><CardTitle>关联的{owner.title}<small className="record-link-caption">（通过「{label}」）</small></CardTitle></CardHeader>
    <CardContent><ul className="record-links">{rows.slice(0, 50).map(row => <li key={row.id}><a href={href(source, row.id)}>{String(row[owner.config.titleField] || row.id)}</a></li>)}</ul></CardContent></Card>;
}

export function RecordFormPage({module, id}: {module: string; id?: string}) {
  const {data, loaded, version} = useModuleData(module);
  const config = {...withLinks(moduleByKey(module), data), rows: data[module]};
  const record = id ? data[module].find(row => row.id === id) : undefined;
  if (id && !record) return <Shell module={module} config={config}><p className="record-page">{loaded ? "记录不存在。" : "加载中…"}</p></Shell>;
  return <Shell module={module} config={config}><RecordForm key={version} module={module} config={config} record={record}/></Shell>;
}

function RecordForm({module, config, record}: {module: string; config: ListDetail; record?: DataRecord}) {
  const router = useRouter(), back = record ? href(module, record.id) : href(module);
  const form = useRecordForm({config, action: record ? "record.update" : "record.create", record, submit: request => repository.submit(module, request), success: saved => router.push(href(module, saved.id))});
  return <article className="record-page record-form-page">
    <a className="record-back" href={back}><ArrowLeft size={14}/>{record ? "返回详情" : `返回${moduleByKey(module).title}`}</a>
    <header className="record-page-header"><div><span className="page-eyebrow">{record ? <Pencil size={12}/> : <Plus size={12}/>} {STORE_LABEL}</span>
      <h1>{record ? `编辑${config.entityName}` : `新建${config.entityName}`}</h1><p>{record ? `修改「${record[config.titleField]}」后保存。` : `填写${config.entityName}信息，带 * 的为必填项。`}</p></div></header>
    <Card className="runtime-card"><CardContent className="record-form-card"><RecordFormBody form={form} close={() => router.push(back)} pendingText="正在保存…"/></CardContent></Card>
  </article>;
}
