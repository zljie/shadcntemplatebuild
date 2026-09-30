import { z } from "zod";
import { registry } from "./registry";
import { pageSchema } from "./schema";
import { createDocument } from "./document";
import { resourceListDetail } from "../runtime/data";

export function componentCapabilities() {
  return Object.entries(registry).map(([componentRef, { schema, ...definition }]) => ({
    componentRef, ...definition, propsSchema: z.toJSONSchema(schema),
    actions: componentRef === "composite.data-table" ? [{event:"row.select",capabilityRef:"context.open"}] : [],
    dynamicSlots: componentRef === "layout.stack" ? ["slot-1","slot-2","slot-3","slot-4","slot-5"] : [],
  }));
}
export function pageProtocol() {
  return {
    schema: z.toJSONSchema(pageSchema),
    rules: [
      "DSL is the source of truth. Use registered componentRefs and strict props only; no code, HTML, CSS or URLs.",
      "Keep locked root workspace then context; use Registry parent and Slot limits. Shell layout and tokens cannot be overridden.",
      "listDetail is optional: absent means legacy resource example. With it, exactly one header, search, table and details is required; table needs row.select -> context.open.",
      "listDetail defines one shared dataset. Fields have unique keys (id, constructor, prototype and __proto__ are reserved). All field references must exist and each reference list must be unique.",
      "Every row has a unique nonempty id, exactly the declared fields and matching primitive types. Maximum 200 rows. dataSource must be example.",
      "Search matches the combined configured searchFields (case insensitive substring). Filters derive options from rows, combine with AND, and use string values; boolean values use true/false with configurable labels.",
      "Put titleField in columns so the name opens details. Use the same title in document.name and page-header props. context props.title names the details panel.",
      "Keep the shared Shell, default spacing and theme. Details use the same desktop panel and narrow-screen Dialog. New pages show SIMULATION 示例数据.",
      "AI generates the DSL, validate_page returns path/message errors, export_project writes a new independent temporary project. MCP has no model or business backend.",
    ],
    template: {...createDocument(), listDetail: resourceListDetail},
  };
}
