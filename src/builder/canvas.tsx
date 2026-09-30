"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/react";
import { ArrowDown, ArrowUp, GripVertical, LockKeyhole, Plus, MousePointer2, Maximize, ChevronRight } from "lucide-react";
import { PageRenderer } from "@/runtime/renderer";
import { useBuilder } from "@/core/store";
import { registry } from "@/core/registry";
import { locate, validateDrop, type Target } from "@/core/validation";
import { viewportWidths, type PageNode } from "@/core/schema";
import { useEditor } from "./editor-context";

export function moveSelected(direction:-1|1){const s=useBuilder.getState();const f=s.selectedId?locate(s.document,s.selectedId):undefined;if(!f?.parent||!f.slot)return;if(f.index+direction<0||f.index+direction>=f.list.length)return;s.dispatch({type:"node.move",nodeId:f.node.id,target:{parentId:f.parent.id,slot:f.slot,index:direction===-1?f.index-1:f.index+2}});}
export function NodeFrame({node,children}:{node:PageNode;children:ReactNode}){
  const selected=useBuilder(s=>s.selectedId===node.id);const select=useBuilder(s=>s.select);const locked=node.meta.locked;
  const {ref,handleRef,isDragging}=useDraggable({id:`node:${node.id}`,data:{nodeId:node.id},disabled:locked});
  const name=registry[node.componentRef]?.name??node.componentRef;
  return <div ref={locked ? undefined : ref} className={`node-frame ${locked?`region-frame region-${node.id}`:""} ${selected?"selected":""} ${isDragging?"dragging":""}`} data-node-id={node.id} tabIndex={0} role="group" aria-label={`编辑 ${name}`}
    onClickCapture={event=>{const el=event.target as HTMLElement;if(el.closest("[data-editor-control]"))return;if(el.closest("[data-node-id]")?.getAttribute("data-node-id")!==node.id)return;event.preventDefault();event.stopPropagation();select(node.id);}}
    onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==="Enter"){select(node.id);event.preventDefault();}if(event.altKey&&(event.key==="ArrowUp"||event.key==="ArrowDown")){select(node.id);moveSelected(event.key==="ArrowUp"?-1:1);event.preventDefault();}}}>
    {!locked&&<div className="node-toolbar" data-editor-control><button ref={handleRef} className="drag-handle" aria-label={`拖动 ${name}`} onClick={()=>select(node.id)}><GripVertical size={12}/><span>{name}</span></button><button aria-label={`上移 ${name}`} onClick={()=>{select(node.id);moveSelected(-1);}}><ArrowUp size={12}/></button><button aria-label={`下移 ${name}`} onClick={()=>{select(node.id);moveSelected(1);}}><ArrowDown size={12}/></button></div>}
    <div className="node-frame-content">{children}</div>
  </div>;
}
export function DropSite({target,empty}:{target:Target;empty:boolean}){
  const {sourceNode,source,chooseTarget,target:chosen}=useEditor();const document=useBuilder(s=>s.document);
  const error=sourceNode?validateDrop(document,sourceNode,target,!!source?.nodeId):null;
  const {ref,isDropTarget}=useDroppable({id:`drop:${target.parentId}:${target.slot}:${target.index}`,data:{target}});
  const active=chosen?.parentId===target.parentId&&chosen.slot===target.slot&&chosen.index===target.index;
  return <button ref={ref} data-editor-control data-testid={`drop-${target.parentId}-${target.slot}-${target.index}`} className={`drop-site ${empty?"empty":""} ${source?"available":""} ${isDropTarget?"over":""} ${error?"invalid":""} ${active?"chosen":""}`} aria-label={`插入到 ${target.parentId} 的 ${target.slot} 第 ${target.index+1} 位`} title={error??"拖入组件，或点击后从组件库添加"} onClick={()=>chooseTarget(target)}>{(empty||isDropTarget)&&<><Plus size={14}/><span>{isDropTarget&&error?error:empty?"将组件拖到这里":"放置组件"}</span></>}</button>;
}
export function Canvas(){const {chooseTarget}=useEditor();function setSlotTarget(parentId:string,slot:string,index:number){chooseTarget({parentId,slot,index});}const document=useBuilder(s=>s.document);const viewport=useBuilder(s=>s.viewport);const mode=useBuilder(s=>s.mode);const selectedId=useBuilder(s=>s.selectedId);const area=useRef<HTMLDivElement>(null);const [available,setAvailable]=useState(1000);const [zoom,setZoom]=useState("fit");const width=viewportWidths[viewport];
  useEffect(()=>{if(!area.current)return;const observer=new ResizeObserver(([entry])=>setAvailable(entry.contentRect.width-64));observer.observe(area.current);return()=>observer.disconnect();},[]);
  const scale=zoom==="fit"?Math.min(1,Math.max(.2,available/width)):Number(zoom);
  const selected=selectedId?locate(document,selectedId)?.node:null;
  return <section className={`canvas-area ${mode==="preview"?"preview-area":""}`} ref={area} aria-label="页面画布">
    <div className="canvas-heading"><span><span className="canvas-page-dot"/>{document.name}<span className="canvas-page-path"> / 默认页面</span></span><span className="canvas-dimensions">{width} × {viewport==="desktop"?900:viewport==="tablet"?768:844}</span></div>
    <div className="canvas-scroll"><div className="device-wrapper" style={{width:width*scale,height:900*scale+32}}><div className="device-frame" style={{width,transform:`scale(${scale})`,transformOrigin:"top left"}}>
      <div className="device-browser"><div className="browser-dots"><i/><i/><i/></div><span><LockKeyhole size={10}/> {document.listDetail?document.name:"acme.workspace / resources"}</span><span className="device-live"><i/> {mode==="edit"?"编辑画布":"交互预览"}</span></div>
      <PageRenderer key={mode} document={document} editing={mode==="edit"}
        frame={mode==="edit"?(node,children)=><NodeFrame key={node.id} node={node}>{children}</NodeFrame>:undefined}
        slot={mode==="edit"?(node,name,children)=><Fragment key={`${node.id}-${name}`}>{node.componentRef==="layout.stack"&&Object.keys(node.slots).length>1&&<button className="slot-label" data-editor-control onClick={()=>{setSlotTarget(node.id,name,children.length);}}>槽位 {Object.keys(node.slots).sort().indexOf(name)+1}</button>}{children.map((child,index)=><Fragment key={(child as {key?:string})?.key??index}><DropSite target={{parentId:node.id,slot:name,index}} empty={false}/>{child}</Fragment>)}<DropSite target={{parentId:node.id,slot:name,index:children.length}} empty={!children.length}/></Fragment>:undefined}/>
    </div></div></div>
    <div className="canvas-bottom"><span><MousePointer2 size={13}/>{mode==="edit"?(selected?<><span>页面</span><ChevronRight size={11}/>{registry[selected.componentRef]?.name}</>:"选择组件以编辑属性，或拖入新组件"):"预览模式 · 可搜索、筛选并查看详情"}</span><label><Maximize size={13}/><span className="sr-only">画布缩放</span><select aria-label="画布缩放" value={zoom} onChange={e=>setZoom(e.target.value)}><option value="fit">适应画布 · {Math.round(scale*100)}%</option><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select></label></div>
  </section>;
}
