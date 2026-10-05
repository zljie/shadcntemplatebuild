"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { baseTypeLabels, baseTypes, objectIcons, type BaseType, type ObjectType, type Property } from "@/ontology/model";

type Row = {apiName: string; displayName: string; baseType: BaseType; required: boolean; options: string; target: string; rest: Partial<Property>};
type Draft = {apiName: string; displayName: string; pluralDisplayName: string; description: string; icon: ObjectType["icon"]; primaryKey: string; titleProperty: string; descriptionProperty: string; rows: Row[]};

const starter: Draft = {apiName: "", displayName: "", pluralDisplayName: "", description: "", icon: "box", primaryKey: "code", titleProperty: "name", descriptionProperty: "",
  rows: [
    {apiName: "code", displayName: "编号", baseType: "string", required: true, options: "", target: "", rest: {}},
    {apiName: "name", displayName: "名称", baseType: "string", required: true, options: "", target: "", rest: {}},
    {apiName: "status", displayName: "状态", baseType: "enum", required: true, options: "草稿, 进行中, 已完成", target: "", rest: {}},
  ]};
function toDraft(type: ObjectType): Draft {
  return {apiName: type.apiName, displayName: type.displayName, pluralDisplayName: type.pluralDisplayName ?? "", description: type.description, icon: type.icon,
    primaryKey: type.primaryKey, titleProperty: type.titleProperty, descriptionProperty: type.descriptionProperty ?? "",
    rows: type.properties.map(({apiName, displayName, baseType, required, options, target, ...rest}) => ({apiName, displayName, baseType, required: !!required, options: options?.join(", ") ?? "", target: target ?? "", rest}))};
}
function fromDraft(d: Draft): Record<string, unknown> {
  return {
    apiName: d.apiName.trim(), displayName: d.displayName.trim(), ...(d.pluralDisplayName.trim() ? {pluralDisplayName: d.pluralDisplayName.trim()} : {}),
    description: d.description, icon: d.icon, primaryKey: d.primaryKey, titleProperty: d.titleProperty, ...(d.descriptionProperty ? {descriptionProperty: d.descriptionProperty} : {}),
    properties: d.rows.map(r => {
      // Keep advanced settings (ranges, defaults, labels) only while they still fit the chosen type.
      const rest = {...r.rest};
      if (!["integer", "decimal"].includes(r.baseType)) { delete rest.min; delete rest.max; }
      if (r.baseType !== "boolean") { delete rest.trueLabel; delete rest.falseLabel; }
      if (rest.default !== undefined && typeof rest.default !== ({integer: "number", decimal: "number", boolean: "boolean"} as Record<string, string>)[r.baseType] && !(typeof rest.default === "string" && ["string", "longText", "date", "enum", "link"].includes(r.baseType))) delete rest.default;
      return {...rest, apiName: r.apiName.trim(), displayName: r.displayName.trim(), baseType: r.baseType, ...(r.required ? {required: true} : {}),
        ...(r.baseType === "enum" ? {options: r.options.split(/[,，\n]/).map(s => s.trim()).filter(Boolean)} : {}),
        ...(r.baseType === "link" ? {target: r.target} : {})};
    }),
  };
}

export function ModelEditor({initial, types, onClose, onSaved}: {initial: ObjectType | null; types: ObjectType[]; onClose: () => void; onSaved: (type: ObjectType) => void}) {
  const [draft, setDraft] = useState<Draft>(() => initial ? toDraft(initial) : structuredClone(starter));
  const [json, setJson] = useState(""), [tab, setTab] = useState("form");
  const [errors, setErrors] = useState<{path: string; message: string}[]>([]), [message, setMessage] = useState(""), [saving, setSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft(d => ({...d, ...patch}));
  const setRow = (i: number, patch: Partial<Row>) => setDraft(d => ({...d, rows: d.rows.map((r, j) => j === i ? {...r, ...patch} : r)}));
  const move = (i: number, by: number) => setDraft(d => { const rows = [...d.rows], [row] = rows.splice(i, 1); rows.splice(i + by, 0, row); return {...d, rows}; });
  const textKeys = draft.rows.filter(r => ["string", "longText"].includes(r.baseType) && r.apiName);
  const error = (path: string) => errors.filter(e => e.path === path || e.path.startsWith(`${path}.`)).map(e => e.message).join("；");

  async function save() {
    let body: Record<string, unknown>;
    if (tab === "json") {
      try { const value = JSON.parse(json); body = Array.isArray(value.types) ? {types: value.types} : {type: value}; }
      catch { setMessage("JSON 格式无效"); return; }
    } else body = {type: fromDraft(draft)};
    setSaving(true); setMessage(""); setErrors([]);
    try {
      const response = await fetch("/api/ontology", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      const result = await response.json();
      if (!response.ok) { setErrors(result.errors ?? []); setMessage(result.error ?? "保存失败"); return; }
      onSaved(result.objectTypes.at(-1));
    } catch { setMessage("保存失败，请检查网络后重试"); }
    finally { setSaving(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="model-editor">
    <DialogTitle>{initial ? `编辑数据模型：${initial.displayName}` : "新建数据模型"}</DialogTitle>
    <DialogDescription>定义对象类型、属性与关联。保存后自动生成列表 + 详情、独立详情和新建 / 编辑页面；已有记录会按新定义读取。</DialogDescription>
    <Tabs value={tab} onValueChange={value => { if (value === "json") setJson(JSON.stringify(fromDraft(draft), null, 2)); setTab(value); }}>
      <TabsList><TabsTrigger value="form">表单</TabsTrigger><TabsTrigger value="json">JSON（可批量导入 {"{types:[…]}"}）</TabsTrigger></TabsList>
      <TabsContent value="form" className="model-form">
        <div className="model-grid-2">
          <label className="model-field">显示名称<input value={draft.displayName} maxLength={20} onChange={e => set({displayName: e.target.value})} placeholder="例如 订单"/><Err text={error("displayName")}/></label>
          <label className="model-field">类型 ID<input value={draft.apiName} disabled={!!initial} maxLength={40} onChange={e => set({apiName: e.target.value.toLowerCase()})} placeholder="例如 order"/><Err text={error("apiName")}/></label>
          <label className="model-field">复数名称（导航与列表标题）<input value={draft.pluralDisplayName} maxLength={40} onChange={e => set({pluralDisplayName: e.target.value})} placeholder="可选"/></label>
          <label className="model-field">图标<select value={draft.icon} onChange={e => set({icon: e.target.value as Draft["icon"]})}>{objectIcons.map(icon => <option key={icon}>{icon}</option>)}</select></label>
        </div>
        <label className="model-field">描述<textarea rows={2} maxLength={500} value={draft.description} onChange={e => set({description: e.target.value})}/></label>
        <div className="model-grid-3">
          <label className="model-field">主键（唯一、必填文本）<select value={draft.primaryKey} onChange={e => set({primaryKey: e.target.value})}>{draft.rows.filter(r => r.baseType === "string" && r.apiName).map(r => <option key={r.apiName} value={r.apiName}>{r.displayName || r.apiName}</option>)}</select><Err text={error("primaryKey")}/></label>
          <label className="model-field">标题属性<select value={draft.titleProperty} onChange={e => set({titleProperty: e.target.value})}>{textKeys.map(r => <option key={r.apiName} value={r.apiName}>{r.displayName || r.apiName}</option>)}</select><Err text={error("titleProperty")}/></label>
          <label className="model-field">描述属性<select value={draft.descriptionProperty} onChange={e => set({descriptionProperty: e.target.value})}><option value="">无</option>{textKeys.map(r => <option key={r.apiName} value={r.apiName}>{r.displayName || r.apiName}</option>)}</select></label>
        </div>
        <fieldset className="model-properties-editor"><legend>属性</legend>
          <div className="property-row property-head" aria-hidden="true"><span>显示名称</span><span>属性名</span><span>类型</span><span>选项 / 关联目标</span><span>必填</span><span/></div>
          {draft.rows.map((row, i) => <div key={i} className="property-row">
            <input aria-label={`属性 ${i + 1} 显示名称`} value={row.displayName} maxLength={40} onChange={e => setRow(i, {displayName: e.target.value})}/>
            <input aria-label={`属性 ${i + 1} 属性名`} value={row.apiName} maxLength={40} onChange={e => setRow(i, {apiName: e.target.value})}/>
            <select aria-label={`属性 ${i + 1} 类型`} value={row.baseType} onChange={e => setRow(i, {baseType: e.target.value as BaseType})}>{baseTypes.map(t => <option key={t} value={t}>{baseTypeLabels[t]}</option>)}</select>
            {row.baseType === "enum" ? <input aria-label={`属性 ${i + 1} 枚举选项`} value={row.options} placeholder="用逗号分隔" onChange={e => setRow(i, {options: e.target.value})}/>
              : row.baseType === "link" ? <select aria-label={`属性 ${i + 1} 关联目标`} value={row.target} onChange={e => setRow(i, {target: e.target.value})}><option value="">选择对象类型</option>{types.map(t => <option key={t.apiName} value={t.apiName}>{t.displayName}</option>)}{draft.apiName && !types.some(t => t.apiName === draft.apiName) && <option value={draft.apiName}>{draft.displayName || draft.apiName}（自身）</option>}</select>
              : <span className="property-none">—</span>}
            <input type="checkbox" aria-label={`属性 ${i + 1} 必填`} checked={row.required} onChange={e => setRow(i, {required: e.target.checked})}/>
            <span className="property-actions">
              <button type="button" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13}/></button>
              <button type="button" aria-label="下移" disabled={i === draft.rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13}/></button>
              <button type="button" aria-label="删除属性" disabled={draft.rows.length === 1} onClick={() => setDraft(d => ({...d, rows: d.rows.filter((_, j) => j !== i)}))}><Trash2 size={13}/></button>
            </span>
            <Err text={error(`properties.${i}`)}/>
          </div>)}
          <Button type="button" size="sm" variant="outline" disabled={draft.rows.length >= 20} onClick={() => setDraft(d => ({...d, rows: [...d.rows, {apiName: `field${d.rows.length + 1}`, displayName: "", baseType: "string", required: false, options: "", target: "", rest: {}}]}))}><Plus size={13}/>添加属性</Button>
        </fieldset>
      </TabsContent>
      <TabsContent value="json"><textarea className="model-json" aria-label="对象类型 JSON" spellCheck={false} value={json} onChange={e => setJson(e.target.value)}/></TabsContent>
    </Tabs>
    <p className="record-form-message" role={message ? "alert" : "status"}>{message}</p>
    <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>取消</Button><Button disabled={saving} onClick={save}>{saving ? "保存中…" : "保存并生成页面"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
function Err({text}: {text: string}) {
  return text ? <small className="record-field-error" role="alert">{text}</small> : null;
}
