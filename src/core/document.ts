import { makeNode } from "./registry";
import { versions, type PageDocument, type PageNode } from "./schema";
import { shells, type ShellRegion, type ShellVariant } from "./shells";
export function makeShellRegion(region: ShellRegion): PageNode {
  const node = makeNode(region.componentRef, region.id);
  if (region.seed) node.slots.children = region.seed.map(ref => makeNode(ref, ref.split(".")[1]));
  return node;
}
export function createDocument(empty = false, variant: ShellVariant = "contextual"): PageDocument {
  const root = shells[variant].regions.map(makeShellRegion);
  if (!empty) root[0].slots.children = variant === "contextual"
    ? [makeNode("pattern.page-header","page-header"),makeNode("composite.search-bar","search-bar"),makeNode("composite.data-table","resource-table")]
    : [makeNode("pattern.page-header","page-header")];
  return {schemaVersion:"0.1.0",id:"resource-page",name:empty?"未命名页面":"资源管理",shell:{variant,version:"0.1.0",workspaceName:"Acme Workspace"},root,dependencies:{...versions}};
}
