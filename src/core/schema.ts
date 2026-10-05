import { z } from "zod";
import { recordActions, type ListDetail } from "../runtime/data";
import { spacing, tokenOptions, themeVersion } from "../runtime/tokens";
export { spacing } from "../runtime/tokens";

export const versions = { pageSchema: "0.1.0", componentRegistry: "0.1.0", designTokens: themeVersion, codeGenerator: "0.1.0" } as const;
export const layoutSchema = z.object({
  direction: z.enum(["column", "row"]).optional(),
  gap: z.enum(spacing).optional(),
  padding: z.enum(spacing).optional(),
  width: z.enum(["width.full", "width.auto"]).optional(),
  align: z.enum(["start", "center", "stretch"]).optional(),
  hidden: z.boolean().optional(),
}).strict();
export const tokenSchema = z.object({
  surface: z.enum(tokenOptions.surface).optional(),
  radius: z.enum(tokenOptions.radius).optional(),
}).strict();
export type Layout = z.infer<typeof layoutSchema>;
export type Tokens = z.infer<typeof tokenSchema>;
export const actionSchema = z.object({event: z.literal("row.select"), capabilityRef: z.literal("context.open")}).strict();
export type PageNode = {
  id: string; componentRef: string; componentVersion: "0.1.0";
  props: Record<string, unknown>; layout: Layout; tokens: Tokens;
  responsive: { tablet?: Layout; mobile?: Layout };
  slots: Record<string, PageNode[]>;
  actions: z.infer<typeof actionSchema>[];
  meta: {locked: boolean};
};
export const nodeSchema: z.ZodType<PageNode> = z.lazy(() => z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
  componentRef: z.string().max(80), componentVersion: z.literal("0.1.0"),
  props: z.record(z.string(), z.unknown()), layout: layoutSchema, tokens: tokenSchema,
  responsive: z.object({tablet: layoutSchema.optional(), mobile: layoutSchema.optional()}).strict(),
  slots: z.record(z.string(), z.array(nodeSchema).max(500)),
  actions: z.array(actionSchema).max(1), meta: z.object({locked: z.boolean()}).strict(),
}).strict());
const fieldKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/).refine(key => !["id", "__proto__", "constructor", "prototype"].includes(key), "保留字段名");
export const listDetailSchema: z.ZodType<ListDetail> = z.object({
  entityName: z.string().min(1).max(20), dataSource: z.literal("example"),
  fields: z.array(z.object({key: fieldKey, label: z.string().min(1).max(40), type: z.enum(["text", "number", "boolean"]), trueLabel: z.string().max(40).optional(), falseLabel: z.string().max(40).optional(),
    default:z.union([z.string().max(1000),z.number().finite(),z.boolean()]).optional(),required:z.boolean().optional(),
    minLength:z.number().int().min(0).max(1000).optional(),maxLength:z.number().int().min(1).max(1000).optional(),
    min:z.number().finite().min(-1e9).max(1e9).optional(),max:z.number().finite().min(-1e9).max(1e9).optional(),integer:z.boolean().optional(),
    options:z.array(z.object({label:z.string().min(1).max(40),value:z.union([z.string().max(1000),z.number().finite(),z.boolean()])}).strict()).min(1).max(30).optional(),
    format:z.enum(["date","textarea"]).optional(),
  }).strict()).min(1).max(20),
  form:z.object({fields:z.array(fieldKey).min(1).max(20),uniqueField:fieldKey,actions:z.array(z.enum(recordActions)).min(1).max(2)}).strict().optional(),
  titleField: fieldKey, descriptionField: fieldKey.optional(),
  columns: z.array(z.object({field: fieldKey, title: z.string().min(1).max(40)}).strict()).min(1).max(10),
  searchFields: z.array(fieldKey).min(1).max(20), filters: z.array(fieldKey).max(3), detailFields: z.array(fieldKey).min(1).max(20),
  rows: z.array(z.object({id:z.string().min(1).max(80)}).catchall(z.union([z.string().max(1000), z.number().finite(), z.boolean()]))).max(200),
}).strict();
export const pageSchema = z.object({
  schemaVersion: z.literal("0.1.0"), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
  shell: z.object({variant: z.literal("contextual"), version: z.literal("0.1.0"), workspaceName: z.string().min(1).max(40)}).strict(),
  root: z.array(nodeSchema).length(2),
  listDetail: listDetailSchema.optional(),
  dependencies: z.object({pageSchema: z.literal(versions.pageSchema), componentRegistry: z.literal(versions.componentRegistry), designTokens: z.literal(versions.designTokens), codeGenerator: z.literal(versions.codeGenerator)}).strict(),
}).strict();
export type PageDocument = z.infer<typeof pageSchema>;
export type Viewport = "desktop" | "tablet" | "mobile";
export const viewportWidths: Record<Viewport, number> = {desktop: 1440, tablet: 1024, mobile: 390};
