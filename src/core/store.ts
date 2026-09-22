import { create } from "zustand";
import { createDocument } from "./document";
import { execute, type Command, type Envelope } from "./commands";
import { type PageDocument, type Viewport } from "./schema";
import { validateDocument, locate, walk } from "./validation";

type HistoryEntry={command:Command;inverse:Command};
export type Draft={document:PageDocument;revision:number;viewport:Viewport;savedAt:string;history:{undo:HistoryEntry[];redo:HistoryEntry[]}};
type State={document:PageDocument;revision:number;selectedId:string|null;viewport:Viewport;mode:"edit"|"preview"|"code";undo:HistoryEntry[];redo:HistoryEntry[];savedAt:string|null;dirty:boolean;message:string;ready:boolean;loadError:boolean;
  dispatch:(command:Command)=>boolean;undoOnce:()=>void;redoOnce:()=>void;select:(id:string|null)=>void;setViewport:(viewport:Viewport)=>void;setMode:(mode:State["mode"])=>void;notify:(message:string)=>void;load:(draft:Draft)=>void;newPage:()=>void;duplicate:()=>void;
};
function envelope(document:PageDocument,revision:number,command:Command):Envelope{return {id:crypto.randomUUID(),timestamp:new Date().toISOString(),actor:{type:"human",id:"local"},pageId:document.id,baseRevision:revision,command};}
export const useBuilder=create<State>((set,get)=>({
  document:createDocument(),revision:0,selectedId:null,viewport:"desktop",mode:"edit",undo:[],redo:[],savedAt:null,dirty:false,message:"",ready:false,loadError:false,
  dispatch(command){const s=get();const r=execute(s.document,s.revision,envelope(s.document,s.revision,command));if(!r.success){set({message:r.errors.map(e=>`${e.path}: ${e.message}`).join("；")});return false;}
    set({document:r.document,revision:r.revision,undo:[...s.undo,{command,inverse:r.inverseCommand}].slice(-50),redo:[],dirty:true,message:"更改已应用",selectedId:s.selectedId&&locate(r.document,s.selectedId)?s.selectedId:null});return true;},
  undoOnce(){const s=get(),entry=s.undo.at(-1);if(!entry)return;const r=execute(s.document,s.revision,envelope(s.document,s.revision,entry.inverse));if(!r.success){set({message:r.errors[0].message});return;}set({document:r.document,revision:r.revision,undo:s.undo.slice(0,-1),redo:[...s.redo,entry],dirty:true,selectedId:null,message:"已撤销"});},
  redoOnce(){const s=get(),entry=s.redo.at(-1);if(!entry)return;const r=execute(s.document,s.revision,envelope(s.document,s.revision,entry.command));if(!r.success){set({message:r.errors[0].message});return;}set({document:r.document,revision:r.revision,redo:s.redo.slice(0,-1),undo:[...s.undo,entry],dirty:true,selectedId:null,message:"已重做"});},
  select(selectedId){set({selectedId});},setViewport(viewport){set({viewport});},setMode(mode){set({mode});},notify(message){set({message});},
  load(draft){const issues=validateDocument(draft.document);if(issues.length)throw new Error(issues.map(e=>`${e.path}: ${e.message}`).join("；"));set({...draft,...draft.history,selectedId:null,dirty:false,ready:true,loadError:false,message:"草稿已恢复"});},
  newPage(){set({document:createDocument(true),revision:0,selectedId:null,undo:[],redo:[],savedAt:null,dirty:true,loadError:false,message:"已创建空白页面"});},
  duplicate(){const s=get();if(!s.selectedId)return;const f=locate(s.document,s.selectedId);if(!f?.parent||!f.slot||f.node.meta.locked)return;const node=structuredClone(f.node);walk([node],n=>{n.id=`n-${crypto.randomUUID()}`;});if(get().dispatch({type:"node.insert",node,target:{parentId:f.parent.id,slot:f.slot,index:f.index+1}}))set({selectedId:node.id,message:"已复制组件"});},
}));
