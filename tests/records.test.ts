import { expect, it } from "vitest";
import { pageProtocol } from "../src/core/page-protocol";
import { validateDocument } from "../src/core/validation";
import { createRecordSession, fieldError } from "../src/runtime/records";
import { readFile } from "node:fs/promises";
import type { PageDocument } from "../src/core/schema";
import { displayValue } from "../src/runtime/data";
import { exportProject } from "../src/core/export-project";

it("shares the form contract, rejects illegal config and exports the exact runtime closure",async()=>{
  const doc=pageProtocol().formTemplate;
  expect(validateDocument(doc)).toEqual([]);
  const mutations=[
    (d:typeof doc)=>{d.listDetail.form.actions.push("unknown.action" as never);},
    (d:typeof doc)=>{d.listDetail.form.fields.push("missing");},
    (d:typeof doc)=>{d.listDetail.fields[2].min=20;d.listDetail.fields[2].max=1;},
    (d:typeof doc)=>{d.listDetail.fields[1].options![0].value=false as never;},
    (d:typeof doc)=>{d.listDetail.fields[2].default=-1;},
    (d:typeof doc)=>{d.listDetail.fields[0].default=undefined as never;},
    (d:typeof doc)=>{d.listDetail.rows[0].quantity=-1;},
  ];
  for(const mutate of mutations){const copy=structuredClone(doc);mutate(copy);expect(validateDocument(copy)).toEqual(expect.arrayContaining([expect.objectContaining({path:expect.stringMatching(/^listDetail/),message:expect.any(String)})]));}
  const files=await exportProject(doc);expect(files["src/runtime/records.ts"]).toContain("createRecordSession");expect(files["src/runtime/components.tsx"]).toContain("BusinessForm");expect(JSON.parse(files["page.dsl.json"])).toEqual(doc);
});

it("validates bypass submissions, deduplicates operations, retains failures, edits atomically and isolates sessions",async()=>{
  const config=pageProtocol().formTemplate.listDetail,before=structuredClone(config),session=createRecordSession(config),other=createRecordSession(config);
  const values={name:"新记录",category:"常规",quantity:0};
  const request={operationId:"create-1",action:"record.create",values};
  const [a,b]=await Promise.all([session.submit(request),session.submit(request)]);
  expect(a).toEqual(b);expect(a.ok).toBe(true);expect(session.rows).toHaveLength(2);expect(other.rows).toEqual(config.rows);expect(config).toEqual(before);
  const invalid=[
    {action:"eval"}, {values:{...values,name:" "}}, {values:{...values,name:"x".repeat(81)}},
    {values:{...values,category:"非法"}}, {values:{...values,quantity:-1}}, {values:{...values,quantity:1.5}}, {values:{...values,quantity:Infinity}},
    {values:{...values,quantity:"1"}}, {values:{...values,url:"https://example.com"}}, {recordId:"chosen"},
  ];
  for(const [i,patch] of invalid.entries()){const result=await session.submit({...request,operationId:`invalid-${i}`,...patch});expect(result.ok).toBe(false);expect(session.rows).toHaveLength(2);}
  const conflict=await session.submit({...request,operationId:"create-1",values:{...values,name:"changed"}});expect(conflict.ok).toBe(false);
  const duplicate=await session.submit({...request,operationId:"duplicate"});expect(duplicate).toMatchObject({ok:false,message:expect.stringContaining("模拟提交失败")});expect(values.name).toBe("新记录");
  if(!a.ok)throw new Error("create failed");
  const edited=await session.submit({operationId:"edit-1",action:"record.update",recordId:a.record.id,values:{...values,name:"修改后的记录",quantity:3}});
  expect(edited.ok).toBe(true);expect(session.rows.find(row=>row.id===a.record.id)?.quantity).toBe(3);expect(other.rows).toHaveLength(1);
  const boolean={key:"enabled",label:"启用状态",type:"boolean" as const,required:true,options:[{label:"启用",value:true},{label:"停用",value:false}]};
  expect(fieldError(boolean,false)).toBeUndefined();expect(fieldError(boolean,"false")).toBeDefined();
},10000);

it("keeps books and users independent and protects read-only loan state",async()=>{
  const books=JSON.parse(await readFile("examples/books.dsl.json","utf8")) as PageDocument,users=JSON.parse(await readFile("examples/users.dsl.json","utf8")) as PageDocument;
  expect(validateDocument(books)).toEqual([]);expect(validateDocument(users)).toEqual([]);
  const b=createRecordSession(books.listDetail!),u=createRecordSession(users.listDetail!);
  const config=books.listDetail!,row=config.rows[1],values=Object.fromEntries(config.form!.fields.map(key=>[key,row[key]]));
  const invalid=await b.submit({operationId:"readonly",action:"record.update",recordId:row.id,values:{...values,loanStatus:"可借阅"}});expect(invalid.ok).toBe(false);
  const result=await b.submit({operationId:"update-book",action:"record.update",recordId:row.id,values:{...values,inventory:7}});expect(result.ok).toBe(true);expect(b.rows.find(item=>item.id===row.id)?.loanStatus).toBe(row.loanStatus);expect(u.rows).toEqual(users.listDetail!.rows);
  expect(displayValue({...config,fields:[{key:"kind",label:"分类",type:"text",options:[{label:"中文标签",value:"internal"}]}]},"kind","internal")).toBe("中文标签");
});
