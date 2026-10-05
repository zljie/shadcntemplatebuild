import { it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createDocument } from "../src/core/document";
import { resourceListDetail } from "../src/runtime/data";

it("discovers and calls all tools over real STDIO, including validation failures and independent export", async () => {
  const client=new Client({name:"page-protocol-check",version:"0.1.0"});
  const transport=new StdioClientTransport({command:process.execPath,args:["--import",path.resolve("node_modules/tsx/dist/loader.mjs"),path.resolve("src/mcp/server.mts")],cwd:"/tmp"});
  const dirs:string[]=[];
  try{
    await client.connect(transport);
    expect((await client.listTools()).tools.map(tool=>tool.name).sort()).toEqual(["apply_commands","export_project","generate_page_code","get_component","get_component_source","get_page_protocol","get_template","list_components","list_templates","save_template","validate_page"]);
    const call=async(name:string,args:Record<string,unknown>={})=>{const result=await client.callTool({name,arguments:args});return result.structuredContent as Record<string,unknown>;};
    expect((await call("list_components")).components).toHaveLength(13);expect((await call("list_components",{detail:"full"})).components).toHaveLength(13);
    const protocol=await call("get_page_protocol");expect(protocol.schema).toBeDefined();expect(protocol.rules).toBeDefined();
    const formDoc=(protocol.formTemplate as ReturnType<typeof import("../src/core/page-protocol").pageProtocol>["formTemplate"]);
    expect(await call("validate_page",{document:formDoc})).toEqual({valid:true,errors:[]});
    for(const mutate of [(d:typeof formDoc)=>{d.listDetail.form.actions[0]="record.delete" as never;},(d:typeof formDoc)=>{d.listDetail.fields[2].min=-1;d.listDetail.fields[2].max=-2;},(d:typeof formDoc)=>{(d.listDetail.form as unknown as Record<string,unknown>).url="https://example.com";}]){const invalid=structuredClone(formDoc);mutate(invalid);expect((await call("validate_page",{document:invalid})).valid).toBe(false);}
    const doc={...createDocument(),listDetail:structuredClone(resourceListDetail)};
    expect(await call("validate_page",{document:doc})).toEqual({valid:true,errors:[]});
    const mutations=[
      (d:typeof doc)=>{d.root[0].slots.children[0].componentRef="unknown.component";},
      (d:typeof doc)=>{d.root[0].slots.children[0].props.unknown="bad";},
      (d:typeof doc)=>{d.root[1].slots.children=[d.root[0].slots.children[2]];},
      (d:typeof doc)=>{d.listDetail.columns[0].field="missing";},
      (d:typeof doc)=>{d.listDetail.rows[0].name=false;},
      (d:typeof doc)=>{d.listDetail.rows[1].id=d.listDetail.rows[0].id;},
    ];
    for(const mutate of mutations){const invalid=structuredClone(doc);mutate(invalid);const result=await call("validate_page",{document:invalid});expect(result.valid).toBe(false);expect(result.errors).toEqual(expect.arrayContaining([expect.objectContaining({path:expect.any(String),message:expect.any(String)})]));expect((await call("export_project",{document:invalid})).valid).toBe(false);}
    const exported=await call("export_project",{document:doc});const dir=exported.projectDir as string;dirs.push(dir);expect(dir.startsWith(process.cwd())).toBe(false);expect(JSON.parse(await readFile(path.join(dir,"page.dsl.json"),"utf8"))).toEqual(doc);expect(await readFile(path.join(dir,"src/runtime/theme.css"),"utf8")).toBe(await readFile("src/runtime/theme.css","utf8"));
  }finally{await client.close();for(const dir of dirs)await rm(dir,{recursive:true,force:true});}
},15000);
