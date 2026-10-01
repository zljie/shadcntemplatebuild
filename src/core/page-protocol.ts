import { z } from "zod";
import { registry } from "./registry";
import { pageSchema } from "./schema";
import { createDocument } from "./document";
import { resourceListDetail, recordActions } from "../runtime/data";

const formExample = {
  entityName:"记录",dataSource:"example" as const,titleField:"name",
  fields:[{key:"name",label:"名称",type:"text" as const,default:"",required:true,minLength:1,maxLength:80},{key:"category",label:"分类",type:"text" as const,default:"常规",required:true,options:[{label:"常规",value:"常规"},{label:"其他",value:"其他"}]},{key:"quantity",label:"数量",type:"number" as const,default:0,required:true,min:0,max:100000,integer:true}],
  columns:[{field:"name",title:"名称"},{field:"category",title:"分类"},{field:"quantity",title:"数量"}],searchFields:["name"],filters:["category"],detailFields:["name","category","quantity"],
  form:{fields:["name","category","quantity"],uniqueField:"name",actions:[...recordActions]},rows:[{id:"example-01",name:"示例记录",category:"常规",quantity:0}],
};

export function componentCapabilities() {
  return Object.entries(registry).map(([componentRef, { schema, ...definition }]) => ({
    componentRef, ...definition, propsSchema: z.toJSONSchema(schema),
    actions: componentRef === "composite.data-table" ? [{event:"row.select",capabilityRef:"context.open"}] : [],
    dynamicSlots: componentRef === "layout.stack" ? ["slot-1","slot-2","slot-3","slot-4","slot-5"] : [],
    runtimeActions: componentRef === "pattern.page-header" ? ["record.create"] : componentRef === "composite.resource-details" ? ["record.update"] : [],
  }));
}
export function pageProtocol() {
  return {
    schema: z.toJSONSchema(pageSchema),
    runtimeActions: recordActions.map(capabilityRef=>({capabilityRef,configuration:"listDetail.form.actions",adapter:"session example data only",entry:capabilityRef==="record.create"?"page header":"selected details",history:"separate from PageCommand; never persisted in DSL"})),
    rules: [
      "DSL is the source of truth. Use registered componentRefs and strict props only; no code, HTML, CSS or URLs.",
      "Keep locked root workspace then context; use Registry parent and Slot limits. Shell layout and tokens cannot be overridden.",
      "listDetail is optional: absent means legacy resource example. With it, exactly one header, search, table and details is required; table needs row.select -> context.open.",
      "listDetail defines one shared dataset. Fields have unique keys (id, constructor, prototype and __proto__ are reserved). All field references must exist and each reference list must be unique.",
      "Every row has a unique nonempty id, exactly the declared fields and matching primitive types. Maximum 200 rows. dataSource must be example.",
      "Search matches the combined configured searchFields (case insensitive substring). Filters derive options from rows, combine with AND, and use string values; boolean values use true/false with configurable labels.",
      "Put titleField in columns so the name opens details. Use the same title in document.name and page-header props. context props.title names the details panel.",
      "Keep the shared Shell, default spacing and theme. Details use the same desktop panel and narrow-screen Dialog. New pages show SIMULATION 示例数据.",
      "To enable shared create/edit Dialog, set listDetail.form = {fields:[editable field keys],uniqueField:required editable text key,actions:['record.create','record.update']}. Never put these runtime actions in node.actions, which only supports row.select -> context.open.",
      "Define field default, required, minLength/maxLength (text), min/max/integer (number), or options:[{label,value}] for single enum. Option primitives must match field type; editable booleans require enum options. Form fields follow configured order. All fields need defaults for create; required editable text may start empty. Read-only fields are omitted from form.fields and retained on edit.",
      "Bound text to at most 1000 characters and numbers to +/-1e9. Existing rows must satisfy field constraints. uniqueField rejects duplicate values in its own dataset as repeatable simulated failure. For books use title (demo-only uniqueness), users use account. Never add passwords or URLs.",
      "Books edit title/author/category/inventory; nonnegative integer inventory, loanStatus read-only with create default 可借阅. Users edit name/account/role/enabled; role and enabled use enums, all four required. Match enum defaults and row values.",
      "Runtime validates payloads again, rejects unknown fields/actions, retains failed input and deduplicates operation IDs. During the 200ms simulated submission, dismiss/cancel/submit are disabled. Success updates list and selected details together. Refresh/reimport/config switch resets fixtures; no database or real API. MCP never edits business records.",
      "AI generates the DSL, validate_page returns path/message errors, export_project writes a new independent temporary project. MCP has no model or business backend.",
    ],
    template: {...createDocument(), listDetail: resourceListDetail},
    formTemplate: {...createDocument(), listDetail: formExample},
  };
}
