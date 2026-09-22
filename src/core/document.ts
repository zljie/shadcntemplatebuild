import { makeNode } from "./registry";
import { versions, type PageDocument } from "./schema";
export function createDocument(empty = false): PageDocument {
  const main = makeNode("region.workspace","workspace");
  const context = makeNode("composite.context-panel","context");
  context.slots.children=[makeNode("composite.resource-details","resource-details")];
  if(!empty) main.slots.children=[makeNode("pattern.page-header","page-header"),makeNode("composite.search-bar","search-bar"),makeNode("composite.data-table","resource-table")];
  return {schemaVersion:"0.1.0",id:"resource-page",name:empty?"未命名页面":"资源管理",shell:{variant:"contextual",version:"0.1.0",workspaceName:"Acme Workspace"},root:[main,context],dependencies:{...versions}};
}
