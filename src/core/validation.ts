import { pageSchema, type PageDocument, type PageNode } from "./schema";
import { registry, slotDefinition } from "./registry";
export type Issue = {path:string;message:string};
export function walk(nodes: PageNode[], visit: (node: PageNode, parent?: PageNode, slot?: string) => void, parent?: PageNode, slot?: string) {
  for(const node of nodes) {visit(node,parent,slot);for(const [key,children] of Object.entries(node.slots))walk(children,visit,node,key);}
}
export function locate(document: PageDocument, id: string): {node: PageNode;parent?: PageNode;slot?:string;list:PageNode[];index:number} | undefined {
  function search(list:PageNode[],parent?:PageNode,slot?:string): ReturnType<typeof locate> {
    for(let index=0;index<list.length;index++){const node=list[index];if(node.id===id)return {node,parent,slot,list,index};for(const [key,children] of Object.entries(node.slots)){const found=search(children,node,key);if(found)return found;}}
  }
  return search(document.root);
}
// Bound recursion before Zod traverses untrusted JSON. No unknown node is discarded.
export function validateDocument(input: unknown): Issue[] {
  let count=0;
  function bound(value:unknown,depth:number): boolean {
    if(depth>45 || ++count>25000)return false;
    if(value && typeof value==="object")return Object.values(value).every(child=>bound(child,depth+1));
    return true;
  }
  if(!bound(input,0))return [{path:"root",message:"文档过深或过大；最多支持 500 个节点、10 层嵌套"}];
  const parsed=pageSchema.safeParse(input);
  if(!parsed.success)return parsed.error.issues.map(e=>({path:e.path.join("."),message:e.message}));
  const document=parsed.data;const errors:Issue[]=[];const ids=new Set<string>();let nodes=0;
  if(document.root[0].componentRef!=="region.workspace" || document.root[0].id!=="workspace" || document.root[1].componentRef!=="composite.context-panel" || document.root[1].id!=="context")errors.push({path:"root",message:"必须保留工作区和详情区及其顺序"});
  function inspect(node:PageNode,parent?:PageNode,depth=0) {
    nodes++;const path=`node.${node.id}`;
    if(depth>10)errors.push({path,message:"最多支持 10 层嵌套"});
    if(ids.has(node.id))errors.push({path,message:"节点 ID 重复"});ids.add(node.id);
    const d=registry[node.componentRef];if(!d){errors.push({path,message:`未注册组件 ${node.componentRef}，请保留原文件并安装对应 Registry`});return;}
    if(d.internal && (parent || !node.meta.locked))errors.push({path,message:"Shell 区域必须在根级锁定"});
    if(parent && !d.parents.includes(parent.componentRef))errors.push({path,message:`${d.name} 不允许放入 ${registry[parent.componentRef]?.name}`});
    const props=d.schema.safeParse(node.props);if(!props.success)for(const issue of props.error.issues)errors.push({path:`${path}.props.${issue.path.join(".")}`,message:issue.message});
    if(node.actions.length && node.componentRef!=="composite.data-table")errors.push({path,message:"该组件不支持 row.select 动作"});
    if(d.internal && (Object.keys(node.layout).length || Object.keys(node.responsive).length || Object.keys(node.tokens).length))errors.push({path,message:"Shell 区域布局与 Token 由规范锁定"});
    if(node.componentRef==="layout.stack")for(const key of Object.keys((node.props.slotWidths??{}) as object))if(!node.slots[key])errors.push({path,message:`槽位宽度引用不存在的 Slot ${key}`});
    for(const key of Object.keys(d.slots))if(!node.slots[key])errors.push({path,message:`缺少 Slot ${key}`});
    for(const [key,children] of Object.entries(node.slots)){
      const slot=slotDefinition(node,key);if(!slot){errors.push({path,message:`未知 Slot ${key}`});continue;}
      if(children.length>slot.max)errors.push({path,message:`${slot.label} 最多容纳 ${slot.max} 个组件`});
      for(const child of children){if(!slot.accepts.includes(child.componentRef))errors.push({path:`${path}.${key}`,message:`${slot.label} 不接受 ${registry[child.componentRef]?.name??child.componentRef}`});inspect(child,node,depth+1);}
    }
  }
  document.root.forEach(n=>inspect(n));
  if(document.listDetail){
    const config=document.listDetail;
    const keys=new Set(config.fields.map(f=>f.key));
    if(keys.size!==config.fields.length)errors.push({path:"listDetail.fields",message:"字段 key 重复"});
    if(!config.columns.some(column=>column.field===config.titleField))errors.push({path:"listDetail.columns",message:"列必须包含 titleField 以便打开详情"});
    const references=[{key:config.titleField,path:"listDetail.titleField"},...(config.descriptionField?[{key:config.descriptionField,path:"listDetail.descriptionField"}]:[]),...config.columns.map((c,i)=>({key:c.field,path:`listDetail.columns.${i}.field`})),...Object.entries({searchFields:config.searchFields,filters:config.filters,detailFields:config.detailFields}).flatMap(([name,values])=>values.map((key,i)=>({key,path:`listDetail.${name}.${i}`})))];
    for(const {key,path} of references)if(!keys.has(key))errors.push({path,message:`引用不存在的字段 ${key}`});
    for(const [name,values] of Object.entries({columns:config.columns.map(c=>c.field),searchFields:config.searchFields,filters:config.filters,detailFields:config.detailFields}))if(new Set(values).size!==values.length)errors.push({path:`listDetail.${name}`,message:"字段引用重复"});
    const rowIds=new Set<string>();
    config.rows.forEach((row,index)=>{
      const path=`listDetail.rows.${index}`;
      if(typeof row.id!=="string"||!row.id||rowIds.has(row.id))errors.push({path:`${path}.id`,message:"记录 id 必须是唯一非空字符串"});
      rowIds.add(String(row.id));
      for(const key of Object.keys(row))if(key!=="id"&&!keys.has(key))errors.push({path:`${path}.${key}`,message:"未声明字段"});
      for(const field of config.fields){const expected=field.type==="text"?"string":field.type;if(typeof row[field.key]!==expected)errors.push({path:`${path}.${field.key}`,message:`字段必须是 ${expected}`});}
    });
    for(const ref of ["pattern.page-header","composite.search-bar","composite.data-table","composite.resource-details"]){let count=0;walk(document.root,node=>{if(node.componentRef===ref)count++;});if(count!==1)errors.push({path:"root",message:`列表／详情模板必须且只能有一个 ${ref}`});}
    walk(document.root,node=>{if(node.componentRef==="composite.data-table"&&!node.actions.some(action=>action.capabilityRef==="context.open"))errors.push({path:`node.${node.id}.actions`,message:"列表／详情模板需要 row.select → context.open"});});
  }
  if(nodes>500)errors.push({path:"root",message:"最多支持 500 个节点"});return errors;
}
export type Target = {parentId:string;slot:string;index:number};
export function validateDrop(document:PageDocument, source:PageNode, target:Target, moving=false): string | null {
  const parent=locate(document,target.parentId)?.node;
  if(!parent)return "目标容器不存在";
  const slot=slotDefinition(parent,target.slot);const list=parent.slots[target.slot];
  if(!slot||!list)return "目标 Slot 不存在";
  if(!Number.isInteger(target.index)||target.index<0||target.index>list.length)return "插入位置无效";
  if(source.meta.locked)return "锁定的 Shell 区域不能移动";
  if(!slot.accepts.includes(source.componentRef)||!registry[source.componentRef]?.parents.includes(parent.componentRef))return `${registry[source.componentRef]?.name??source.componentRef} 不能放入${registry[parent.componentRef]?.name}的${slot.label}`;
  if(moving){let cycle=false;walk([source],node=>{if(node.id===parent.id)cycle=true;});if(cycle)return "不能将组件移入自身或后代";}
  const alreadyHere=moving&&list.some(n=>n.id===source.id);
  if(list.length>=slot.max&&!alreadyHere)return `${slot.label} 已达到组件数量上限`;
  return null;
}
