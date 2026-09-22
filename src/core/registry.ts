import { z } from "zod";
import { spacing, type PageNode } from "./schema";

export type Field = {key: string; label: string; type: "text" | "textarea" | "select"; options?: string[]};
export type Definition = {
  name: string; description: string; category: "布局" | "基础" | "业务";
  exportName: string; importPath: "@/runtime/components";
  schema: z.ZodType; fields: Field[]; defaults: Record<string, unknown>;
  slots: Record<string, {label: string; accepts: string[]; max: number}>;
  parents: string[]; internal?: boolean;
};
const text = z.string().max(200);
const longText = z.string().max(1000);
const field = (key: string, label: string, type: Field["type"] = "text", options?: string[]): Field => ({key,label,type,options});
const definition = (value: Omit<Definition, "importPath">): Definition => ({...value, importPath: "@/runtime/components"});
const content = ["layout.stack", "shadcn.card", "shadcn.button", "shadcn.input", "pattern.page-header", "composite.search-bar", "composite.data-table", "composite.empty-state"];
const parents = ["region.workspace", "layout.stack", "shadcn.card"];
export const registry: Record<string, Definition> = {
  "region.workspace": definition({name:"工作区",description:"锁定的主内容区域",category:"布局",exportName:"WorkspacePane",schema:z.object({}).strict(),fields:[],defaults:{},slots:{children:{label:"主内容",accepts:content,max:100}},parents:[],internal:true}),
  "layout.stack": definition({name:"Stack",description:"有序排列一组组件",category:"布局",exportName:"Stack",schema:z.object({slotWidths:z.record(z.string().regex(/^(children|slot-[1-5])$/),z.enum(["fill","auto"])).optional()}).strict(),fields:[],defaults:{},slots:{children:{label:"内容",accepts:content,max:50}},parents}),
  "shadcn.card": definition({name:"Card",description:"有边界的内容容器",category:"基础",exportName:"CardBlock",schema:z.object({title:text}).strict(),fields:[field("title","卡片标题")],defaults:{title:"内容卡片"},slots:{children:{label:"卡片内容",accepts:content.filter(x=>x!=="pattern.page-header"),max:30}},parents}),
  "shadcn.button": definition({name:"Button",description:"标准操作按钮",category:"基础",exportName:"ButtonBlock",schema:z.object({text:text.min(1),variant:z.enum(["default","outline","secondary"]),message:text.min(1)}).strict(),fields:[field("text","按钮文案"),field("variant","按钮样式","select",["default","outline","secondary"]),field("message","点击提示")],defaults:{text:"了解更多",variant:"outline",message:"这是可配置的示例操作。"},slots:{},parents}),
  "shadcn.input": definition({name:"Input",description:"带标签的文本输入",category:"基础",exportName:"InputBlock",schema:z.object({label:text.min(1),placeholder:text}).strict(),fields:[field("label","字段标签"),field("placeholder","占位文案")],defaults:{label:"资源名称",placeholder:"输入资源名称"},slots:{},parents}),
  "pattern.page-header": definition({name:"PageHeader",description:"页面标题与说明",category:"业务",exportName:"PageHeader",schema:z.object({title:text.min(1),description:longText}).strict(),fields:[field("title","页面标题"),field("description","页面说明","textarea")],defaults:{title:"资源中心",description:"集中管理工作空间中的技能、工具和知识。"},slots:{},parents:["region.workspace","layout.stack"]}),
  "composite.search-bar": definition({name:"SearchBar",description:"搜索与资源类型筛选",category:"业务",exportName:"SearchBar",schema:z.object({placeholder:text}).strict(),fields:[field("placeholder","搜索提示")],defaults:{placeholder:"搜索资源名称或描述…"},slots:{},parents}),
  "composite.data-table": definition({name:"DataTable",description:"可搜索的资源列表",category:"业务",exportName:"DataTable",schema:z.object({density:z.enum(["comfortable","compact"])}).strict(),fields:[field("density","行间距","select",["comfortable","compact"])],defaults:{density:"comfortable"},slots:{},parents}),
  "composite.empty-state": definition({name:"EmptyState",description:"空白页面的清晰引导",category:"业务",exportName:"EmptyState",schema:z.object({title:text.min(1),description:longText}).strict(),fields:[field("title","标题"),field("description","说明","textarea")],defaults:{title:"这里还没有内容",description:"添加组件，开始构建你的页面。"},slots:{},parents}),
  "composite.context-panel": definition({name:"ContextPanel",description:"锁定的资源详情区域",category:"布局",exportName:"ContextPanel",schema:z.object({title:text.min(1)}).strict(),fields:[field("title","面板标题")],defaults:{title:"资源详情"},slots:{children:{label:"详情内容",accepts:["composite.resource-details"],max:1}},parents:[],internal:true}),
  "composite.resource-details": definition({name:"ResourceDetails",description:"所选资源的详细信息",category:"业务",exportName:"ResourceDetails",schema:z.object({}).strict(),fields:[],defaults:{},slots:{},parents:["composite.context-panel"]}),
};
export const layoutFields: Field[] = [field("direction","排列方向","select",["column","row"]),field("gap","组件间距","select",[...spacing]),field("padding","内边距","select",[...spacing]),field("width","宽度","select",["width.full","width.auto"]),field("align","对齐方式","select",["start","center","stretch"])];
export const tokenFields: Field[] = [field("surface","背景","select",["color.surface","color.muted"]),field("radius","圆角","select",["radius.sm","radius.md","radius.lg"])];
export function makeNode(componentRef: string, id = `n-${crypto.randomUUID()}`): PageNode {
  const d = registry[componentRef];
  if(!d) throw new Error(`未注册组件：${componentRef}`);
  return {id,componentRef,componentVersion:"0.1.0",props:{...d.defaults},layout:componentRef==="layout.stack"?{direction:"column",gap:"space.4"}:{},tokens:{},responsive:{},slots:Object.fromEntries(Object.keys(d.slots).map(key=>[key,[]])),actions:componentRef==="composite.data-table"?[{event:"row.select",capabilityRef:"context.open"}]:[],meta:{locked:!!d.internal}};
}

export function slotDefinition(node:PageNode, name:string){
  if(node.componentRef==="layout.stack" && /^slot-[1-5]$/.test(name))return registry["layout.stack"].slots.children;
  return registry[node.componentRef]?.slots[name];
}
