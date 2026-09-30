import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createDocument } from "../src/core/document";
import { execute, type Command, type Result } from "../src/core/commands";
import { makeNode, registry, componentSources, tokenFields } from "../src/core/registry";
import { readFile } from "node:fs/promises";
import { presentation } from "../src/runtime/presentation";
import { spacing, tokenOptions, tokenValues, themeVersion } from "../src/runtime/tokens";
import { layoutSchema, tokenSchema, versions } from "../src/core/schema";
import { validateDocument, locate } from "../src/core/validation";
import { generateReact } from "../src/core/generator";
import { exportProject } from "../src/core/export-project";
import { PageRenderer } from "../src/runtime/renderer";
import type { PageDocument } from "../src/core/schema";
function run(document:PageDocument,command:Command,revision=0){return execute(document,revision,{id:"test",timestamp:"2026-09-22T00:00:00Z",actor:{type:"human",id:"test"},pageId:document.id,baseRevision:revision,command});}
function ok(result:Result){expect(result.success).toBe(true);if(!result.success)throw new Error(JSON.stringify(result.errors));return result;}
function inverseCheck(document:PageDocument,command:Command){const result=ok(run(document,command));const restored=ok(run(result.document,result.inverseCommand,1));expect(restored.document).toEqual(document);return result.document;}
describe("DSL and command integrity",()=>{
  it("validates the example and rejects unknown fields/tokens/components without mutating input",()=>{const doc=createDocument();expect(validateDocument(doc)).toEqual([]);const copy=structuredClone(doc);copy.root[0].slots.children[0].componentRef="unknown.script";expect(validateDocument(copy).some(e=>e.message.includes("未注册"))).toBe(true);expect(copy.root[0].slots.children).toHaveLength(3);expect(validateDocument({...doc,arbitraryCss:"position:absolute"}).length).toBeGreaterThan(0);expect(run(doc,{type:"node.update",nodeId:"page-header",value:{tokens:{surface:"red"} as never}}).success).toBe(false);expect(doc).toEqual(createDocument());});
  it("reverses insert, delete and props/layout/token/responsive edits",()=>{const doc=createDocument();inverseCheck(doc,{type:"node.insert",node:makeNode("shadcn.card","card"),target:{parentId:"workspace",slot:"children",index:1}});inverseCheck(doc,{type:"node.remove",nodeId:"search-bar"});inverseCheck(doc,{type:"node.update",nodeId:"page-header",value:{props:{title:"新标题",description:"updated"},layout:{padding:"space.6"},tokens:{surface:"color.muted"},responsive:{mobile:{hidden:true}}}});});
  it("reverses every same-slot insertion boundary including no-op",()=>{for(let from=0;from<3;from++)for(let to=0;to<=3;to++){const doc=createDocument();inverseCheck(doc,{type:"node.move",nodeId:doc.root[0].slots.children[from].id,target:{parentId:"workspace",slot:"children",index:to}});}});
  it("reverses cross-container moves",()=>{let doc=createDocument();doc=ok(run(doc,{type:"node.insert",node:makeNode("layout.stack","stack"),target:{parentId:"workspace",slot:"children",index:3}})).document;const moved=inverseCheck(doc,{type:"node.move",nodeId:"search-bar",target:{parentId:"stack",slot:"children",index:0}});expect(locate(moved,"stack")?.node.slots.children[0].id).toBe("search-bar");});
  it("rejects cycles, Shell changes, duplicate IDs, excess slots, illegal parents and stale revisions",()=>{const doc=createDocument();doc.root[0].slots.children.push(makeNode("layout.stack","stack"));for(const command of [{type:"node.move",nodeId:"stack",target:{parentId:"stack",slot:"children",index:0}},{type:"node.remove",nodeId:"workspace"},{type:"node.insert",node:makeNode("shadcn.button","page-header"),target:{parentId:"workspace",slot:"children",index:0}},{type:"node.move",nodeId:"resource-table",target:{parentId:"context",slot:"children",index:0}},{type:"node.insert",node:makeNode("composite.resource-details","detail2"),target:{parentId:"context",slot:"children",index:1}}] as Command[])expect(run(doc,command).success).toBe(false);expect(execute(doc,2,{id:"stale",timestamp:"",actor:{type:"human",id:"test"},pageId:doc.id,baseRevision:1,command:{type:"page.rename",name:"stale"}}).success).toBe(false);});
  it("rolls back an invalid batch and reverses a successful atomic batch",()=>{const doc=createDocument();const before=structuredClone(doc);const rename:Command={type:"page.rename",name:"新的页面"};expect(run(doc,{type:"batch",commands:[rename,{type:"node.remove",nodeId:"workspace"}]}).success).toBe(false);expect(doc).toEqual(before);inverseCheck(doc,{type:"batch",commands:[rename,{type:"node.remove",nodeId:"search-bar"}]});});
  it("rejects unsupported versions and deep documents without dropping data",()=>{const doc=createDocument();expect(validateDocument({...doc,schemaVersion:"9.0.0"}).length).toBeGreaterThan(0);let node=doc.root[0];for(let i=0;i<20;i++){const child=makeNode("layout.stack",`nested-${i}`);node.slots.children=[child];node=child;}expect(validateDocument(doc).length).toBeGreaterThan(0);});
});
describe("Renderer and export",()=>{
  it("renders the actual registry components without editor chrome",()=>{const html=renderToStaticMarkup(createElement(PageRenderer,{document:createDocument()}));expect(html).toContain("品牌文案助手");expect(html).toContain("搜索资源");expect(html).not.toContain("node-toolbar");});
  it("preserves unknown nodes with a visible placeholder",()=>{const doc=createDocument();doc.root[0].slots.children[0].componentRef="missing";expect(renderToStaticMarkup(createElement(PageRenderer,{document:doc}))).toContain("节点数据已保留");});
  it("emits deterministic safe TSX and complete independent artifacts",async()=>{const doc=createDocument();doc.root[0].slots.children[0].props.title='</h1><script>alert("x")</script>';const a=await exportProject(doc),b=await exportProject(doc);const hash=(files:Record<string,string>)=>createHash("sha256").update(JSON.stringify(files)).digest("hex");expect(hash(a)).toBe(hash(b));expect(a["src/app/page.tsx"]).toContain('title={\'</h1><script>alert("x")</script>\'}');const pkg=JSON.parse(a["package.json"]);expect(pkg.dependencies.zustand).toBeUndefined();expect(pkg.dependencies["@dnd-kit/react"]).toBeUndefined();expect(Object.keys(a).some(p=>p.includes("builder"))).toBe(false);expect(a["src/app/page.tsx"]).not.toContain("PageRenderer");expect(a["src/app/page.tsx"]).not.toContain("node-layout");});
  it("rejects invalid exports",async()=>{const doc=createDocument();doc.root[0].slots.children[0].props.title=undefined;await expect(generateReact(doc)).rejects.toThrow();});
});

describe("Stack slots",()=>{
  function slotted(){const doc=createDocument();const stack=makeNode("layout.stack","stack");stack.layout={direction:"row",gap:"space.4",align:"center"};stack.props={slotWidths:{children:"fill","slot-1":"auto"}};stack.slots={children:[doc.root[0].slots.children[1]],"slot-1":[makeNode("shadcn.button","action")]};doc.root[0].slots.children.splice(1,1,stack);return doc;}
  it("preserves slots, widths and component order in JSON, renderer and generated project",async()=>{
    const doc=slotted();expect(validateDocument(doc)).toEqual([]);
    expect(validateDocument(JSON.parse(JSON.stringify(doc)))).toEqual([]);
    const html=renderToStaticMarkup(createElement(PageRenderer,{document:doc}));
    expect(html).toContain('stack-slot-fill" data-slot="children"');expect(html).toContain('stack-slot-auto" data-slot="slot-1"');
    const files=await exportProject(doc);expect(JSON.parse(files["page.dsl.json"])).toEqual(doc);
    expect(files["src/app/page.tsx"]).toContain('<StackSlot name={"slot-1"} width={"auto"}>');
    expect(files["src/app/page.tsx"].indexOf("<SearchBar")).toBeLessThan(files["src/app/page.tsx"].indexOf("<ButtonBlock"));
  });
  it("reverses slot creation, deletion, widths and cross-slot moves",()=>{
    const doc=slotted();const stack=locate(doc,"stack")!.node;
    const expanded=inverseCheck(doc,{type:"node.update",nodeId:"stack",value:{slots:{...stack.slots,"slot-2":[]}}});
    inverseCheck(expanded,{type:"node.update",nodeId:"stack",value:{slots:stack.slots}});
    inverseCheck(doc,{type:"node.update",nodeId:"stack",value:{props:{slotWidths:{children:"auto","slot-1":"fill"}}}});
    const moved=inverseCheck(doc,{type:"node.move",nodeId:"action",target:{parentId:"stack",slot:"children",index:1}});
    expect(locate(moved,"stack")!.node.slots.children.map(n=>n.id)).toEqual(["search-bar","action"]);
  });
  it("rejects unknown slots, dangling widths, invalid widths and editing Shell slots",()=>{
    const doc=slotted(),stack=locate(doc,"stack")!.node;
    for(const key of ["slot-6","arbitrary"])expect(run(doc,{type:"node.update",nodeId:"stack",value:{slots:{...stack.slots,[key]:[]}}}).success).toBe(false);
    for(const slotWidths of [{"slot-5":"auto"},{children:"100px"}])expect(run(doc,{type:"node.update",nodeId:"stack",value:{props:{slotWidths}}}).success).toBe(false);
    expect(run(doc,{type:"node.update",nodeId:"workspace",value:{slots:{children:[]}}}).success).toBe(false);
  });
});


describe("Component sources and shared theme",()=>{
  it("records every implementation, real symbol, source file and dependency without claiming an upstream version",async()=>{
    const files=await exportProject(createDocument());
    const pkg=JSON.parse(files["package.json"]);
    expect(Object.keys(registry)).toHaveLength(11);
    for(const definition of Object.values(registry)){
      expect(definition.source.name).toBe("project");
      expect(definition).toMatchObject(componentSources[definition.exportName]);
      expect(definition.schema.safeParse(definition.defaults).success).toBe(true);
    }
    for(const [symbol,source] of Object.entries(componentSources)){
      expect(source.exportName).toBe(symbol);
      const sourceModule=await import("../"+source.files[0]);
      expect(sourceModule[symbol]).toBeDefined();
      expect(source.importPath).toBe("@/"+source.files[0].slice(4).replace(/\.tsx?$/, ""));
      expect(source.responsibility.length).toBeGreaterThan(0);
      expect(source.source.evidence.length).toBeGreaterThan(0);
      for(const file of source.files)expect(files[file]).toBe(await readFile(file,"utf8"));
      for(const dependency of source.componentDependencies)expect(componentSources[dependency]).toBeDefined();
      for(const dependency of source.npmDependencies)expect(pkg.dependencies[dependency]).toBeDefined();
      if(source.source.name==="shadcn")expect(source.source.upstreamVersion).toBeNull();
    }
    expect(registry["shadcn.button"].componentDependencies).toContain("Button");
    expect(registry["composite.data-table"].source.name).toBe("project");
  });
  it("shares DSL options, CSS variables, presentation mapping and exported theme sources",async()=>{
    const files=await exportProject(createDocument());
    expect(versions.designTokens).toBe(themeVersion);
    expect(tokenFields.map(field=>field.options)).toEqual([tokenOptions.surface,tokenOptions.radius]);
    for(const value of spacing){
      expect(layoutSchema.safeParse({gap:value}).success).toBe(true);
      expect(presentation({layout:{gap:value},responsive:{mobile:{padding:value}}}).style).toMatchObject({"--node-gap":tokenValues[value],"--m-node-padding":tokenValues[value]});
    }
    for(const [key,values] of Object.entries(tokenOptions))for(const value of values){
      expect(tokenSchema.safeParse({[key]:value}).success).toBe(true);
      expect(presentation({tokens:{[key]:value}}).style).toMatchObject({["--node-"+key]:tokenValues[value]});
    }
    for(const value of Object.values(tokenValues))expect(files["src/runtime/theme.css"]).toContain(value.slice(4,-1)+":");
    for(const file of ["src/runtime/tokens.ts","src/runtime/theme.css","src/runtime/styles.css","src/runtime/components.tsx","src/runtime/presentation.ts"])
      expect(files[file]).toBe(await readFile(file,"utf8"));
    expect(files["src/app/globals.css"]).toContain('@import "../runtime/styles.css"');
    expect(files["src/runtime/styles.css"]).toContain('@import "./theme.css"');
    expect(files["src/runtime/theme.css"]).toContain(".page-surface, .runtime-detail-dialog");
    expect(files["src/app/globals.css"]).not.toContain("builder");
    expect(presentation({tokens:{surface:"red"},layout:{padding:"99px"}}).style).toEqual({});
  });
});
