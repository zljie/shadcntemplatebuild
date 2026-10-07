import { produce } from "immer";
import { z } from "zod";
import { layoutSchema, tokenSchema, nodeSchema, listDetailSchema, permissionsSchema, type PageDocument, type PageNode, type Permissions } from "./schema";
import { normalizePermissions, permissionIssues } from "./permissions";
import { shells, shellVariants, type ShellVariant } from "./shells";
import { makeShellRegion } from "./document";
import type { ListDetail } from "../runtime/data";
import { locate, validateDocument, validateDrop, type Issue, type Target } from "./validation";

const targetSchema=z.object({parentId:z.string(),slot:z.string(),index:z.number().int().nonnegative()}).strict();
const updateSchema=z.object({
  slots:z.record(z.string(),z.array(nodeSchema).max(50)).optional(),
  props:z.record(z.string(),z.unknown()).optional(),layout:layoutSchema.optional(),tokens:tokenSchema.optional(),
  responsive:z.object({tablet:layoutSchema.optional(),mobile:layoutSchema.optional()}).strict().optional(),
}).strict();
type Update = z.infer<typeof updateSchema>;
export type Command =
  | {type:"node.insert";node:PageNode;target:Target}
  | {type:"node.move";nodeId:string;target:Target}
  | {type:"node.remove";nodeId:string}
  | {type:"node.update";nodeId:string;value:Update}
  | {type:"node.permissions";nodeId:string;permissions?:Permissions}
  | {type:"page.rename";name:string}
  | {type:"page.listDetail";listDetail?:ListDetail}
  | {type:"page.shell";variant:ShellVariant;regions?:PageNode[]}
  | {type:"batch";commands:Command[]};
export const commandSchema:z.ZodType<Command>=z.lazy(()=>z.discriminatedUnion("type",[
  z.object({type:z.literal("node.insert"),node:nodeSchema,target:targetSchema}).strict(),
  z.object({type:z.literal("node.move"),nodeId:z.string(),target:targetSchema}).strict(),
  z.object({type:z.literal("node.remove"),nodeId:z.string()}).strict(),
  z.object({type:z.literal("node.update"),nodeId:z.string(),value:updateSchema}).strict(),
  z.object({type:z.literal("node.permissions"),nodeId:z.string(),permissions:permissionsSchema.optional()}).strict(),
  z.object({type:z.literal("page.rename"),name:z.string().trim().min(1).max(80)}).strict(),
  z.object({type:z.literal("page.listDetail"),listDetail:listDetailSchema.optional()}).strict(),
  z.object({type:z.literal("page.shell"),variant:z.enum(shellVariants),regions:z.array(nodeSchema).max(2).optional()}).strict(),
  z.object({type:z.literal("batch"),commands:z.array(commandSchema).min(1).max(100)}).strict(),
]));
export type Envelope={id:string;timestamp:string;actor:{type:"human"|"agent"|"system";id:string};pageId:string;baseRevision:number;command:Command};
export type Result={success:true;document:PageDocument;revision:number;inverseCommand:Command}|{success:false;errors:Issue[]};
export function execute(document:PageDocument,revision:number,envelope:Envelope):Result {
  if(envelope.pageId!==document.id||envelope.baseRevision!==revision)return {success:false,errors:[{path:"baseRevision",message:"页面版本已变化，请重新操作"}]};
  const parsed=commandSchema.safeParse(envelope.command);
  if(!parsed.success)return {success:false,errors:parsed.error.issues.map(e=>({path:e.path.join("."),message:e.message}))};
  try {
    function apply(doc:PageDocument, command:Command):{document:PageDocument;inverse:Command} {
      if(command.type==="batch"){
        let current=doc;const inverse:Command[]=[];
        for(const c of command.commands){const result=apply(current,c);current=result.document;inverse.unshift(result.inverse);}
        return {document:current,inverse:{type:"batch",commands:inverse}};
      }
      let inverse:Command | undefined;
      const next=produce(doc,draft=>{
        if(command.type==="page.rename"){inverse={type:"page.rename",name:draft.name};draft.name=command.name;return;}
        if(command.type==="page.listDetail"){inverse=draft.listDetail?{type:"page.listDetail",listDetail:JSON.parse(JSON.stringify(draft.listDetail))}:{type:"page.listDetail"};if(command.listDetail)draft.listDetail=command.listDetail as typeof draft.listDetail;else delete draft.listDetail;return;}
        if(command.type==="page.shell"){
          // Regions kept by id; dropped ones travel in the inverse so undo restores them exactly.
          const previous:PageNode[]=JSON.parse(JSON.stringify(draft.root));
          inverse={type:"page.shell",variant:draft.shell.variant,regions:previous};
          const pool=[...(command.regions??[]),...previous];
          draft.root=shells[command.variant].regions.map(region=>{const kept=pool.find(n=>n.id===region.id&&n.componentRef===region.componentRef);return kept?JSON.parse(JSON.stringify(kept)):makeShellRegion(region);});
          draft.shell.variant=command.variant;return;
        }
        if(command.type==="node.insert"){
          const error=validateDrop(draft,command.node,command.target);if(error)throw new Error(error);
          locate(draft,command.target.parentId)!.node.slots[command.target.slot].splice(command.target.index,0,command.node);
          inverse={type:"node.remove",nodeId:command.node.id};return;
        }
        const found=locate(draft,command.nodeId);if(!found)throw new Error("节点不存在");
        if(command.type==="node.permissions"){
          if(found.node.meta.locked)throw new Error("Shell 区域的权限由规范锁定");
          inverse=found.node.meta.permissions?{type:"node.permissions",nodeId:command.nodeId,permissions:{...found.node.meta.permissions}}:{type:"node.permissions",nodeId:command.nodeId};
          const next=command.permissions&&normalizePermissions(found.node,command.permissions);
          if(next)found.node.meta.permissions=next;else delete found.node.meta.permissions;return;
        }
        if(command.type==="node.update"){
          if(command.value.slots&&found.node.componentRef!=="layout.stack")throw new Error("仅 Stack 支持编辑槽位");
          const previous:Update={};
          for(const key of Object.keys(command.value) as (keyof Update)[]){Object.assign(previous,{[key]:structuredClone(JSON.parse(JSON.stringify(found.node[key])))});Object.assign(found.node,{[key]:command.value[key]});}
          inverse={type:"node.update",nodeId:command.nodeId,value:previous};return;
        }
        if(!found.parent||!found.slot)throw new Error("锁定的 Shell 区域不能删除或移动");

        const originalTarget={parentId:found.parent.id,slot:found.slot,index:found.index};
        if(command.type==="node.remove"){
          inverse={type:"node.insert",node:JSON.parse(JSON.stringify(found.node)),target:originalTarget};found.list.splice(found.index,1);return;
        }
        const error=validateDrop(draft,found.node,command.target,true);if(error)throw new Error(error);
        const dest=locate(draft,command.target.parentId)!.node.slots[command.target.slot];
        const same=dest===found.list;
        const index=command.target.index-(same&&found.index<command.target.index?1:0);
        const [node]=found.list.splice(found.index,1);dest.splice(index,0,node);
        // Target indices refer to insertion boundaries BEFORE removal, including inverses.
        inverse={type:"node.move",nodeId:node.id,target:{...originalTarget,index:originalTarget.index+(same&&index<originalTarget.index?1:0)}};
      });
      if(!inverse)throw new Error("命令缺少逆操作");
      return {document:next,inverse};
    }
    const result=apply(document,parsed.data);const denied=permissionIssues(document,result.document);if(denied.length)return {success:false,errors:denied};const issues=validateDocument(result.document);
    if(issues.length)return {success:false,errors:issues};
    return {success:true,document:result.document,revision:revision+1,inverseCommand:result.inverse};
  } catch(error){return {success:false,errors:[{path:"command",message:error instanceof Error?error.message:"命令执行失败"}]};}
}
