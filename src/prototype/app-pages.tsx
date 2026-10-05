"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { PageRenderer } from "@/runtime/renderer";
import { ContextualShell, RecordFormBody, RuntimeProvider, WorkspacePane, useRecordForm, useRuntime, type Navigation, type RecordAdapter } from "@/runtime/components";
import { displayValue, type DataRecord, type ListDetail } from "@/runtime/data";
import type { RecordResult } from "@/runtime/records";
import type { PageDocument } from "@/core/schema";
import { NONE } from "@/ontology/model";

export const STORE_LABEL = "SQLite 数据库";
export function apiAdapter(objectType: string): RecordAdapter {
  return {
    label: STORE_LABEL,
    async submit(request) {
      const response = await fetch(`/api/objects/${encodeURIComponent(objectType)}`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(request)});
      const result = await response.json() as RecordResult | {error: string};
      if ("ok" in result) return result;
      throw new Error(result.error);
    },
  };
}
const href = (type: string, id?: string, suffix = "") => `/apps/${type}${id ? `/${encodeURIComponent(id)}` : ""}${suffix}`;

export function ListDetailApp({document, objectType, navigation}: {document: PageDocument; objectType: string; navigation: Navigation}) {
  const [adapter] = useState(() => apiAdapter(objectType));
  return <PageRenderer document={document} adapter={adapter} navigation={navigation}/>;
}

type LinkGroup = {type: {apiName: string; displayName: string}; property: string; records: {id: string; title: string}[]};
export type DetailProps = {objectType: string; config: ListDetail; record: DataRecord; linkTargets: Record<string, string>; incoming: LinkGroup[]; navigation: Navigation; canEdit: boolean; listTitle: string; workspaceName: string};

export function RecordDetailApp(props: DetailProps) {
  const [adapter] = useState(() => apiAdapter(props.objectType));
  return <RuntimeProvider listDetail={props.config} pageTitle={props.listTitle} adapter={adapter} navigation={props.navigation} initialSelectedId={props.record.id}>
    <ContextualShell workspaceName={props.workspaceName}><WorkspacePane><RecordDetail {...props}/></WorkspacePane></ContextualShell>
  </RuntimeProvider>;
}

function RecordDetail({objectType, record: initial, linkTargets, incoming, canEdit, listTitle}: DetailProps) {
  const {config, selected, openForm, notify} = useRuntime();
  const router = useRouter();
  const record = selected ?? initial;
  const [confirm, setConfirm] = useState(false), [deleting, setDeleting] = useState(false);
  const title = displayValue(config, config.titleField, record[config.titleField]);
  const fields = config.fields.filter(f => f.key !== config.titleField && f.key !== config.descriptionField);
  async function remove() {
    setDeleting(true);
    const response = await fetch(`/api/objects/${encodeURIComponent(objectType)}/${encodeURIComponent(record.id)}`, {method: "DELETE"});
    if (response.ok) { router.push(href(objectType)); router.refresh(); return; }
    setDeleting(false); setConfirm(false); notify("删除失败，请重试。");
  }
  return <article className="record-page">
    <a className="record-back" href={href(objectType)}><ArrowLeft size={14}/>返回{listTitle}</a>
    <header className="record-page-header">
      <div><span className="page-eyebrow">{config.entityName} · {STORE_LABEL}</span><h1>{title}</h1>{config.descriptionField && <p>{String(record[config.descriptionField])}</p>}</div>
      <div className="record-page-actions">
        {config.form?.actions.includes("record.update") && (canEdit
          ? <Button asChild variant="outline"><a href={href(objectType, record.id, "/edit")}><Pencil size={14}/>编辑</a></Button>
          : <Button variant="outline" onClick={() => openForm("record.update", record)}><Pencil size={14}/>编辑</Button>)}
        <Button variant="outline" className="record-delete" onClick={() => setConfirm(true)}><Trash2 size={14}/>删除</Button>
      </div>
    </header>
    <Card className="runtime-card"><CardHeader><CardTitle>基本信息</CardTitle></CardHeader><CardContent>
      <dl className="record-fields">{fields.map(field => {
        const value = record[field.key], target = linkTargets[field.key];
        return <div key={field.key}><dt>{field.label}</dt><dd>{target && value !== NONE
          ? <a href={href(target, String(value))}><Link2 size={12}/>{displayValue(config, field.key, value)}</a>
          : field.format === "date" && !value ? "—" : displayValue(config, field.key, value) || "—"}</dd></div>;
      })}</dl>
    </CardContent></Card>
    {incoming.map(group => <Card className="runtime-card" key={`${group.type.apiName}-${group.property}`}>
      <CardHeader><CardTitle>关联的{group.type.displayName}<small className="record-link-caption">（通过「{group.property}」）</small></CardTitle></CardHeader>
      <CardContent><ul className="record-links">{group.records.map(r => <li key={r.id}><a href={href(group.type.apiName, r.id)}>{r.title}<ArrowUpRight size={12}/></a></li>)}</ul></CardContent>
    </Card>)}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogTitle>删除{config.entityName}</DialogTitle>
      <DialogDescription>将从{STORE_LABEL}中永久删除「{title}」。关联到它的记录会显示为未设置。</DialogDescription>
      <DialogFooter><Button variant="outline" disabled={deleting} onClick={() => setConfirm(false)}>取消</Button><Button variant="destructive" disabled={deleting} onClick={remove}>{deleting ? "删除中…" : "确认删除"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </article>;
}

export type FormProps = {objectType: string; config: ListDetail; record?: DataRecord; navigation: Navigation; listTitle: string; hasDetail: boolean; workspaceName: string};
export function RecordFormApp(props: FormProps) {
  const [adapter] = useState(() => apiAdapter(props.objectType));
  return <RuntimeProvider listDetail={props.config} pageTitle={props.listTitle} adapter={adapter} navigation={props.navigation}>
    <ContextualShell workspaceName={props.workspaceName}><WorkspacePane><RecordForm {...props} adapter={adapter}/></WorkspacePane></ContextualShell>
  </RuntimeProvider>;
}
function RecordForm({objectType, config, record, listTitle, hasDetail, adapter}: FormProps & {adapter: RecordAdapter}) {
  const router = useRouter();
  const back = record && hasDetail ? href(objectType, record.id) : href(objectType);
  const form = useRecordForm({config, action: record ? "record.update" : "record.create", record, submit: adapter.submit,
    success: saved => { router.push(hasDetail ? href(objectType, saved.id) : href(objectType)); router.refresh(); }});
  return <article className="record-page record-form-page">
    <a className="record-back" href={back}><ArrowLeft size={14}/>{record ? "返回详情" : `返回${listTitle}`}</a>
    <header className="record-page-header"><div><span className="page-eyebrow">{record ? <Pencil size={12}/> : <Plus size={12}/>} {STORE_LABEL}</span>
      <h1>{record ? `编辑${config.entityName}` : `新建${config.entityName}`}</h1><p>{record ? `修改「${record[config.titleField]}」，保存后立即生效。` : `填写${config.entityName}信息，带 * 的为必填项。`}</p></div></header>
    <Card className="runtime-card"><CardContent className="record-form-card"><RecordFormBody form={form} close={() => router.push(back)} pendingText="正在保存…"/></CardContent></Card>
  </article>;
}
