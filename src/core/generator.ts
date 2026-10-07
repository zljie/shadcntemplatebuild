import { format } from "prettier";
import { registry } from "./registry";
import type { PageDocument, PageNode } from "./schema";
import { validateDocument, walk } from "./validation";
import { hasDetailsRegion } from "./shells";
export function stableStringify(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(stableStringify).join(",")}]`;
  if(value!==null&&typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export async function generateReact(document:PageDocument):Promise<string>{
  const issues=validateDocument(document);if(issues.length)throw new Error(issues.map(i=>`${i.path}: ${i.message}`).join("；"));
  const imports=new Map<string,Set<string>>();
  imports.set("@/runtime/components",new Set(["ContextualShell","RuntimeProvider"]));
  walk(document.root,node=>{const d=registry[node.componentRef];if(!imports.has(d.importPath))imports.set(d.importPath,new Set());imports.get(d.importPath)!.add(d.exportName);});
  function emit(node:PageNode):string {
    const name=registry[node.componentRef].exportName;
    const props:Record<string,unknown>={...node.props};
    if(Object.keys(node.layout).length)props.layout=node.layout;
    if(Object.keys(node.tokens).length)props.tokens=node.tokens;
    if(Object.keys(node.responsive).length)props.responsive=node.responsive;
    if(node.componentRef==="composite.data-table")props.openDetails=hasDetailsRegion(document.root)&&node.actions.some(a=>a.capabilityRef==="context.open");
    const attributes=Object.entries(props).sort(([a],[b])=>a<b?-1:1).map(([k,v])=>`${k}={${stableStringify(v)}}`).join(" ");
    const slots=Object.entries(node.slots).sort(([a],[b])=>a.localeCompare(b)).map(([name,nodes])=>`${JSON.stringify(name)}:<>${nodes.map(emit).join("\n")}</>`).join(",\n");
    return `<${name} ${attributes}${slots?` slots={{${slots}}}`:""}/>`;
  }
  const source=`"use client";\n${[...imports].sort(([a],[b])=>a<b?-1:1).map(([path,names])=>`import { ${[...names].sort().join(", ")} } from ${JSON.stringify(path)};`).join("\n")}\nexport default function Page(){return <RuntimeProvider${document.listDetail?` listDetail={${stableStringify(document.listDetail)}} pageTitle={${JSON.stringify(document.name)}}`:""}><ContextualShell workspaceName={${JSON.stringify(document.shell.workspaceName)}}>${document.root.map(emit).join("\n")}</ContextualShell></RuntimeProvider>}`;
  return format(source,{parser:"typescript",semi:true,singleQuote:false,trailingComma:"all"});
}
