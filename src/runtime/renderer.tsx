"use client";
import { type ComponentType, type ReactNode } from "react";
import { type PageDocument, type PageNode } from "@/core/schema";
import { registry } from "@/core/registry";
import * as components from "./components";
export function PageRenderer({document,frame,slot,editing=false}:{document:PageDocument;frame?:(node:PageNode,children:ReactNode)=>ReactNode;slot?:(node:PageNode,name:string,children:ReactNode[])=>ReactNode;editing?:boolean}){
  function render(node:PageNode):ReactNode {
    const definition=registry[node.componentRef];
    const Component=definition&&(components as unknown as Record<string,ComponentType<Record<string,unknown>>>)[definition.exportName];
    if(!Component)return <div key={node.id} role="alert">缺少组件：{node.componentRef}。节点数据已保留。</div>;
    const children=Object.entries(node.slots).sort(([a],[b])=>a.localeCompare(b)).map(([name,nodes])=>{
      const content=slot?slot(node,name,nodes.map(render)):nodes.map(render);
      return node.componentRef==="layout.stack"&&Object.keys(node.slots).length>1?<components.StackSlot key={name} name={name} width={(node.props.slotWidths as Record<string,"fill"|"auto">|undefined)?.[name]}>{content}</components.StackSlot>:content;
    });
    const extra=node.componentRef==="composite.context-panel"?{editing}:node.componentRef==="composite.data-table"?{openDetails:node.actions.some(a=>a.capabilityRef==="context.open")}:{};
    const element=<Component key={node.id} {...node.props} layout={node.layout} tokens={node.tokens} responsive={node.responsive} {...extra}>{children}</Component>;
    return frame?frame(node,element):element;
  }
  return <components.RuntimeProvider><components.ContextualShell workspaceName={document.shell.workspaceName}>{document.root.map(render)}</components.ContextualShell></components.RuntimeProvider>;
}
