"use client";
import { type ComponentType, type ReactNode } from "react";
import { type PageDocument, type PageNode } from "@/core/schema";
import { registry } from "@/core/registry";
import { hasDetailsRegion } from "@/core/shells";
import * as components from "./components";
export function PageRenderer({document,frame,slot,editing=false,adapter,navigation}:{document:PageDocument;frame?:(node:PageNode,children:ReactNode)=>ReactNode;slot?:(node:PageNode,name:string,children:ReactNode[])=>ReactNode;editing?:boolean;adapter?:components.RecordAdapter;navigation?:components.Navigation}){
  const details=hasDetailsRegion(document.root);
  function render(node:PageNode):ReactNode {
    const definition=registry[node.componentRef];
    const Component=definition&&(components as unknown as Record<string,ComponentType<Record<string,unknown>>>)[definition.exportName];
    if(!Component)return <div key={node.id} role="alert">缺少组件：{node.componentRef}。节点数据已保留。</div>;
    const slots=Object.fromEntries(Object.entries(node.slots).sort(([a],[b])=>a.localeCompare(b)).map(([name,nodes])=>{
      const children=nodes.map(render);
      return [name,slot?slot(node,name,children):children];
    }));
    const extra=node.componentRef==="composite.context-panel"||node.componentRef==="shadcn.tabs"?{editing}:node.componentRef==="composite.data-table"?{openDetails:details&&node.actions.some(a=>a.capabilityRef==="context.open")}:{};
    const element=<Component key={node.id} {...node.props} layout={node.layout} tokens={node.tokens} responsive={node.responsive} {...extra} slots={slots}/>;
    return frame?frame(node,element):element;
  }
  return <components.RuntimeProvider key={JSON.stringify(document.listDetail)} listDetail={document.listDetail} pageTitle={document.name} adapter={adapter} navigation={navigation}><components.ContextualShell workspaceName={document.shell.workspaceName}>{document.root.map(render)}</components.ContextualShell></components.RuntimeProvider>;
}
