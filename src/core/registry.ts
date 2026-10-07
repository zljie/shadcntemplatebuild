import { z } from "zod";
import { spacing, type PageNode, type Permissions } from "./schema";
import { tokenOptions } from "../runtime/tokens";

export type Field = {key: string; label: string; type: "text" | "textarea" | "select"; options?: string[]};
export type ComponentSource = {
  role: "ui" | "layout" | "composition" | "adapter" | "runtime" | "utility";
  source: { name: "project" | "shadcn"; evidence: string[]; upstreamVersion?: null };
  exportName: string; importPath: string; files: string[];
  componentDependencies: string[]; npmDependencies: string[]; responsibility: string;
};
const projectSource = (exportName: string, role: ComponentSource["role"], responsibility: string, componentDependencies: string[], npmDependencies: string[] = ["react"], file = "src/runtime/components.tsx"): ComponentSource => ({
  role, source: {name: "project", evidence: [file]}, exportName,
  importPath: "@/" + file.slice(4).replace(/\.(tsx?|css)$/, ""), files: [file],
  componentDependencies, npmDependencies, responsibility,
});
const uiSource = (exportName: string, name: string, componentDependencies: string[], npmDependencies: string[]): ComponentSource => ({
  role: "ui", source: {name: "shadcn", upstreamVersion: null, evidence: ["components.json", `src/components/ui/${name}.tsx`, "git:a17c443"]},
  exportName, importPath: `@/components/ui/${name}`, files: [`src/components/ui/${name}.tsx`],
  componentDependencies, npmDependencies, responsibility: "已有 shadcn 基础 UI 源码；准确上游版本及本地修改差异待核实",
});
// Direct source/dependency records, not a resolver. The shared runtime module is exported in full.
// Keys identify actual exported symbols; DSL entries retain their existing componentRef.
export const componentSources: Record<string, ComponentSource> = {
  Button: uiSource("Button", "button", ["cn"], ["react", "radix-ui", "class-variance-authority"]),
  Input: uiSource("Input", "input", ["cn"], ["react"]),
  Card: uiSource("Card", "card", ["cn"], ["react"]),
  CardContent: uiSource("CardContent", "card", ["cn"], ["react"]),
  CardHeader: uiSource("CardHeader", "card", ["cn"], ["react"]),
  CardTitle: uiSource("CardTitle", "card", ["cn"], ["react"]),
  Dialog: uiSource("Dialog", "dialog", ["cn", "Button"], ["react", "radix-ui", "lucide-react"]),
  DialogContent: uiSource("DialogContent", "dialog", ["Dialog", "Button", "cn"], ["react", "radix-ui", "lucide-react"]),
  DialogTitle: uiSource("DialogTitle", "dialog", ["Dialog"], ["react", "radix-ui"]),
  DialogDescription: uiSource("DialogDescription", "dialog", ["Dialog"], ["react", "radix-ui"]),
  Badge: uiSource("Badge", "badge", ["cn"], ["react", "radix-ui", "class-variance-authority"]),
  Tabs: uiSource("Tabs", "tabs", ["cn"], ["react", "radix-ui", "class-variance-authority"]),
  TabsList: uiSource("TabsList", "tabs", ["Tabs", "cn"], ["react", "radix-ui", "class-variance-authority"]),
  TabsTrigger: uiSource("TabsTrigger", "tabs", ["Tabs", "cn"], ["react", "radix-ui"]),
  TabsContent: uiSource("TabsContent", "tabs", ["Tabs", "cn"], ["react", "radix-ui"]),
  cn: projectSource("cn", "utility", "组合 className 与 Tailwind 类", [], ["clsx", "tailwind-merge"], "src/core/utils.ts"),
  tokenValues: {...projectSource("tokenValues", "utility", "受控 DSL Token 到共享 CSS variables 的唯一映射", [], [], "src/runtime/tokens.ts"), files: ["src/runtime/tokens.ts", "src/runtime/theme.css", "src/runtime/styles.css"]},
  presentation: projectSource("presentation", "adapter", "受控布局、响应式与 Token 转换为节点样式", ["tokenValues"], [], "src/runtime/presentation.ts"),
  resources: projectSource("resources", "runtime", "本地示例资源数据，不接真实 API", [], [], "src/runtime/data.ts"),
  resourceListDetail: projectSource("resourceListDetail", "runtime", "旧 DSL 的默认列表／详情配置", ["resources"], [], "src/runtime/data.ts"),
  displayValue: projectSource("displayValue", "utility", "按字段类型显示 primitive 值，保留 0 与 false", [], [], "src/runtime/data.ts"),
  filterRows: projectSource("filterRows", "runtime", "按同一配置执行本地搜索与 AND 筛选；最多 200 条示例记录", ["displayValue"], [], "src/runtime/data.ts"),
  recordActions: projectSource("recordActions", "runtime", "唯一注册的会话记录动作：新增与编辑", [], [], "src/runtime/data.ts"),
  fieldError: projectSource("fieldError", "utility", "表单及模拟适配边界复用的字段校验", [], [], "src/runtime/records.ts"),
  validateBusinessConfig: projectSource("validateBusinessConfig", "utility", "页面校验器与模拟适配边界复用的字段／动作契约检查", ["fieldError", "recordActions"], [], "src/runtime/records.ts"),
  createRecordSession: projectSource("createRecordSession", "runtime", "隔离的会话内模拟新增／编辑；边界校验与操作幂等，不修改 DSL", ["validateBusinessConfig", "fieldError", "recordActions"], [], "src/runtime/records.ts"),
  BusinessForm: projectSource("BusinessForm", "composition", "统一 Dialog 表单、默认值／回填、字段反馈、提交锁和焦点恢复", ["fieldError", "Button", "Input", "Dialog", "DialogContent", "DialogTitle", "DialogDescription"], ["react", "lucide-react"]),
  useRuntime: projectSource("useRuntime", "runtime", "读取 Runtime 状态与动作", ["RuntimeProvider"]),
  RuntimeProvider: projectSource("RuntimeProvider", "runtime", "持有共享列表／详情配置与隔离的会话记录、选择、表单和提示状态", ["resourceListDetail", "createRecordSession", "BusinessForm"]),
  ContextualShell: projectSource("ContextualShell", "layout", "锁定 Shell、导航与提示区域；折叠状态及提示动作由 Runtime 承担", ["useRuntime"], ["react", "lucide-react"]),
  StackSlot: projectSource("StackSlot", "layout", "独立槽位与 fill/auto 布局", []),
  ResourceIcon: projectSource("ResourceIcon", "composition", "按资源类型选择 Lucide 图标", [], ["react", "lucide-react"]),
  WorkspacePane: projectSource("WorkspacePane", "layout", "锁定的主内容区域", []),
  Stack: projectSource("Stack", "layout", "排列 DSL 子节点；不实现基础 UI", ["presentation", "StackSlot"]),
  CardBlock: projectSource("CardBlock", "adapter", "DSL 标题、内容槽位和布局适配，底层 Card 来自 shadcn", ["presentation", "Card", "CardContent", "CardHeader", "CardTitle"]),
  ButtonBlock: projectSource("ButtonBlock", "adapter", "DSL 文案与 variant 适配、示例提示动作，底层 Button 来自 shadcn", ["presentation", "Button", "useRuntime"], ["react", "lucide-react"]),
  BadgeBlock: projectSource("BadgeBlock", "adapter", "DSL 文案与 variant 适配，底层 Badge 来自 shadcn", ["presentation", "Badge"]),
  TabsSlot: projectSource("TabsSlot", "layout", "标记 Tabs 的命名槽位", []),
  TabsBlock: projectSource("TabsBlock", "adapter", "DSL 标签与三个命名槽位适配；编辑态平铺全部面板，底层 Tabs 来自 shadcn", ["presentation", "Tabs", "TabsList", "TabsTrigger", "TabsContent", "TabsSlot"]),
  InputBlock: projectSource("InputBlock", "adapter", "DSL 标签、占位文案与可访问 ID 适配，底层 Input 来自 shadcn", ["presentation", "Input"]),
  PageHeader: projectSource("PageHeader", "composition", "组合页面标题、说明与配置数据统计；兼容原资源指标", ["presentation", "resources", "useRuntime"], ["react", "lucide-react"]),
  SearchBar: projectSource("SearchBar", "composition", "组合 shadcn Input、原生 select 与 Runtime 搜索筛选", ["presentation", "Input", "useRuntime", "displayValue"], ["react", "lucide-react"]),
  DataTable: projectSource("DataTable", "composition", "项目原生 table、配置字段、搜索筛选与选行动作；不是 shadcn 通用 DataTable", ["presentation", "filterRows", "displayValue", "ResourceIcon", "useRuntime"], ["react", "lucide-react"]),
  EmptyState: projectSource("EmptyState", "composition", "项目空白引导组合", ["presentation"], ["react", "lucide-react"]),
  ContextPanel: projectSource("ContextPanel", "layout", "锁定详情区域；适配窄屏 shadcn Dialog 和关闭动作", ["useRuntime", "Dialog", "DialogContent", "DialogTitle", "DialogDescription"], ["react", "lucide-react"]),
  ResourceDetails: projectSource("ResourceDetails", "composition", "按共享配置组合所选示例记录字段与详情说明", ["presentation", "ResourceIcon", "useRuntime", "displayValue"], ["react", "lucide-react"]),
};
export type Definition = ComponentSource & {
  name: string; description: string; category: "布局" | "基础" | "业务";
  schema: z.ZodType; fields: Field[]; defaults: Record<string, unknown>;
  slots: Record<string, {label: string; accepts: string[]; max: number}>;
  parents: string[]; internal?: boolean;
  /** Component-level permission defaults (layer 2 of 3, see core/permissions.ts). */
  permissions?: Permissions;
  /** Dynamic inspector fields: derive the visible field list from current props (defaults to `fields`). */
  resolveFields?: (props: Record<string, unknown>) => Field[];
  /**
   * AI generation hints (chat agent + MCP). instructions/fields guide the model; exclude hides the
   * component from AI catalogues and rejects AI-inserted instances; excludeFields keeps those props at
   * their current value (or default for new nodes) under AI edits. Hints never override Schema rules.
   */
  ai?: {instructions?: string; fields?: Record<string, string>; exclude?: boolean; excludeFields?: string[]};
};
const text = z.string().max(200);
const longText = z.string().max(1000);
const field = (key: string, label: string, type: Field["type"] = "text", options?: string[]): Field => ({key,label,type,options});
const definition = (value: Omit<Definition, keyof ComponentSource> & {exportName: string}): Definition => ({...componentSources[value.exportName], ...value});
const content = ["layout.stack", "shadcn.card", "shadcn.tabs", "shadcn.button", "shadcn.input", "shadcn.badge", "pattern.page-header", "composite.search-bar", "composite.data-table", "composite.empty-state"];
const parents = ["region.workspace", "layout.stack", "shadcn.card", "shadcn.tabs"];
const tabSlot = (label: string) => ({label, accepts: content.filter(x=>x!=="pattern.page-header"&&x!=="shadcn.tabs"), max: 30});
export const registry: Record<string, Definition> = {
  "region.workspace": definition({name:"工作区",description:"锁定的主内容区域",category:"布局",exportName:"WorkspacePane",schema:z.object({}).strict(),fields:[],defaults:{},slots:{children:{label:"主内容",accepts:content,max:100}},parents:[],internal:true}),
  "layout.stack": definition({ai:{"instructions":"用于组合和排列组件。子组件放入已声明的 slots；多槽位可用 children 和 slot-1 至 slot-5，slotWidths 只引用实际存在的槽位。响应式布局使用 responsive，不生成任意 CSS。"},name:"Stack",description:"有序排列一组组件",category:"布局",exportName:"Stack",schema:z.object({slotWidths:z.record(z.string().regex(/^(children|slot-[1-5])$/),z.enum(["fill","auto"])).optional()}).strict(),fields:[],defaults:{},slots:{children:{label:"内容",accepts:content,max:50}},parents}),
  "shadcn.card": definition({name:"Card",description:"有边界的内容容器",category:"基础",exportName:"CardBlock",schema:z.object({title:text}).strict(),fields:[field("title","卡片标题")],defaults:{title:"内容卡片"},slots:{children:{label:"卡片内容",accepts:content.filter(x=>x!=="pattern.page-header"),max:30}},parents}),
  "shadcn.button": definition({ai:{"instructions":"用于示例操作提示。点击只显示 message，不支持 API 请求、导航或业务提交；新增和编辑记录由业务表单入口承担。","fields":{"text":"简短、明确的操作文案。","message":"点击后显示的示例提示，不得声称已执行真实业务操作。"}},name:"Button",description:"标准操作按钮",category:"基础",exportName:"ButtonBlock",schema:z.object({text:text.min(1),variant:z.enum(["default","outline","secondary"]),message:text.min(1)}).strict(),fields:[field("text","按钮文案"),field("variant","按钮样式","select",["default","outline","secondary"]),field("message","点击提示")],defaults:{text:"了解更多",variant:"outline",message:"这是可配置的示例操作。"},slots:{},parents}),
  "shadcn.input": definition({ai:{"instructions":"用于独立文本输入展示，不会自动绑定业务字段或搜索。搜索用 composite.search-bar，业务表单字段配置在 document.listDetail 中。","fields":{"label":"可访问的字段标签，必须非空。","placeholder":"输入提示，不替代字段标签。"}},name:"Input",description:"带标签的文本输入",category:"基础",exportName:"InputBlock",schema:z.object({label:text.min(1),placeholder:text}).strict(),fields:[field("label","字段标签"),field("placeholder","占位文案")],defaults:{label:"资源名称",placeholder:"输入资源名称"},slots:{},parents}),
  "shadcn.badge": definition({name:"Badge",description:"状态或标签徽标",category:"基础",exportName:"BadgeBlock",schema:z.object({text:text.min(1).max(40),variant:z.enum(["default","secondary","outline","destructive"])}).strict(),fields:[field("text","徽标文案"),field("variant","徽标样式","select",["default","secondary","outline","destructive"])],defaults:{text:"新",variant:"secondary"},slots:{},parents}),
  "shadcn.tabs": definition({ai:{"instructions":"子组件放在 slots tab-1/tab-2/tab-3，最多三个页签；label 为空的页签不显示。保留全部声明槽位，不向隐藏页签添加用户需要看见的内容。","fields":{"label1":"第一个页签标题，必须非空。","label2":"第二个页签标题；空字符串隐藏此页签。","label3":"第三个页签标题；空字符串隐藏此页签。"}},name:"Tabs",description:"分页签切换的内容区（最多 3 个，标签留空即隐藏）",category:"基础",exportName:"TabsBlock",schema:z.object({label1:text.min(1).max(40),label2:text.max(40),label3:text.max(40)}).strict(),fields:[field("label1","页签 1"),field("label2","页签 2（留空隐藏）"),field("label3","页签 3（留空隐藏）")],resolveFields:props=>[field("label1","页签 1"),field("label2","页签 2（留空隐藏）"),...(props.label2||props.label3?[field("label3","页签 3（留空隐藏）")]:[])],defaults:{label1:"概览",label2:"详情",label3:""},slots:{"tab-1":tabSlot("页签 1"),"tab-2":tabSlot("页签 2"),"tab-3":tabSlot("页签 3")},parents:["region.workspace","layout.stack","shadcn.card"]}),
  "pattern.page-header": definition({ai:{"instructions":"列表／详情页面只放一个页面标题组件。业务表单的新增入口由 listDetail.form.actions 中的 record.create 启用，不用独立 Button 模拟提交。","fields":{"title":"页面标题。","description":"简短说明此页面的用途。"}},name:"PageHeader",description:"页面标题与说明",category:"业务",exportName:"PageHeader",schema:z.object({title:text.min(1),description:longText}).strict(),fields:[field("title","页面标题"),field("description","页面说明","textarea")],defaults:{title:"资源中心",description:"集中管理工作空间中的技能、工具和知识。"},slots:{},parents:["region.workspace","layout.stack"]}),
  "composite.search-bar": definition({ai:{"instructions":"搜索和筛选来自 document.listDetail.searchFields 和 filters，均须引用已声明字段；不要在组件 props 中添加数据字段。"},name:"SearchBar",description:"按页面配置搜索与筛选",category:"业务",exportName:"SearchBar",schema:z.object({placeholder:text}).strict(),fields:[field("placeholder","搜索提示")],defaults:{placeholder:"搜索资源名称或描述…"},slots:{},parents}),
  "composite.data-table": definition({ai:{"instructions":"业务列表／详情页（listDetail）需要恰好一个 pattern.page-header、composite.search-bar、composite.data-table（actions 为 row.select→context.open）及 context 中的 composite.resource-details。字段、列、示例记录和表单写在 document.listDetail，不放进组件 props；改名或删除字段时同步所有引用和示例记录。不需要列表时可省略 listDetail，用 Card/Tabs/Badge/Button/Input/Stack 组合页面。","fields":{"density":"comfortable 为常规行距，compact 为紧凑行距，不影响业务数据。"}},name:"DataTable",description:"可配置的业务列表",category:"业务",exportName:"DataTable",schema:z.object({density:z.enum(["comfortable","compact"])}).strict(),fields:[field("density","行间距","select",["comfortable","compact"])],defaults:{density:"comfortable"},slots:{},parents}),
  "composite.empty-state": definition({name:"EmptyState",description:"空白页面的清晰引导",category:"业务",exportName:"EmptyState",schema:z.object({title:text.min(1),description:longText}).strict(),fields:[field("title","标题"),field("description","说明","textarea")],defaults:{title:"这里还没有内容",description:"添加组件，开始构建你的页面。"},slots:{},parents}),
  "composite.context-panel": definition({name:"ContextPanel",description:"锁定的详情区域",category:"布局",exportName:"ContextPanel",schema:z.object({title:text.min(1)}).strict(),fields:[field("title","面板标题")],defaults:{title:"资源详情"},slots:{children:{label:"详情内容",accepts:["composite.resource-details"],max:1}},parents:[],internal:true}),
  "composite.resource-details": definition({ai:{"instructions":"放在锁定 context 的 children 槽位中；详情字段引用 document.listDetail.detailFields。编辑入口由 listDetail.form.actions 中的 record.update 启用，不把它写入 node.actions。"},name:"ResourceDetails",description:"按页面配置展示所选记录详情（保留旧引用）",category:"业务",exportName:"ResourceDetails",schema:z.object({}).strict(),fields:[],defaults:{},slots:{},parents:["composite.context-panel"]}),
};
export const layoutFields: Field[] = [field("direction","排列方向","select",["column","row"]),field("gap","组件间距","select",[...spacing]),field("padding","内边距","select",[...spacing]),field("width","宽度","select",["width.full","width.auto"]),field("align","对齐方式","select",["start","center","stretch"])];
export const tokenFields: Field[] = [field("surface","背景","select",[...tokenOptions.surface]),field("radius","圆角","select",[...tokenOptions.radius])];
export function makeNode(componentRef: string, id = `n-${crypto.randomUUID()}`): PageNode {
  const d = registry[componentRef];
  if(!d) throw new Error(`未注册组件：${componentRef}`);
  return {id,componentRef,componentVersion:"0.1.0",props:{...d.defaults},layout:componentRef==="layout.stack"?{direction:"column",gap:"space.4"}:{},tokens:{},responsive:{},slots:Object.fromEntries(Object.keys(d.slots).map(key=>[key,[]])),actions:componentRef==="composite.data-table"?[{event:"row.select",capabilityRef:"context.open"}]:[],meta:{locked:!!d.internal}};
}

export function slotDefinition(node:PageNode, name:string){
  if(node.componentRef==="layout.stack" && /^slot-[1-5]$/.test(name))return registry["layout.stack"].slots.children;
  return registry[node.componentRef]?.slots[name];
}
