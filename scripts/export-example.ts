import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { exportProject } from "../src/core/export-project";
import { createDocument } from "../src/core/document";
async function main(){
  const output=path.resolve("exports/resource-page");
  const files=await exportProject(createDocument());
  for(const [name,content] of Object.entries(files)){const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}
  console.log(`Exported ${Object.keys(files).length} files to ${output}`);
}
main();
