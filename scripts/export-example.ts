import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportProject } from "../src/core/export-project";
import { createDocument } from "../src/core/document";
import { makeNode } from "../src/core/registry";
async function main(){
  const output=path.resolve(process.env.EXPORT_DIR??"exports/resource-page");
  const document=createDocument();
  if(process.argv.includes("--theme-check")){
    const stack=makeNode("layout.stack","theme-stack"),action=makeNode("shadcn.button","theme-button");
    stack.layout={direction:"row",gap:"space.4",padding:"space.2",align:"center"};
    stack.tokens={surface:"color.muted",radius:"radius.md"};stack.responsive={mobile:{direction:"column",gap:"space.2"}};
    action.props.variant="default";stack.props={slotWidths:{children:"fill","slot-1":"auto"}};
    stack.slots={children:[document.root[0].slots.children[1]],"slot-1":[action]};
    document.root[0].slots.children.splice(1,1,stack);
    const card=makeNode("shadcn.card","theme-card");card.slots.children=[makeNode("shadcn.input","theme-input")];
    card.tokens={surface:"color.surface",radius:"radius.lg"};document.root[0].slots.children.push(card);
  }
  const files=await exportProject(document);
  for(const [name,content] of Object.entries(files)){const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}
  console.log(`Exported ${Object.keys(files).length} files to ${output}`);
}
main();
