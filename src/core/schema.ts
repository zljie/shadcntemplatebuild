import { z } from "zod";
import { recordActions, type CapabilityDataSource, type ListDetail } from "../runtime/data";
import { capabilityRefPattern, type CommandAction } from "../runtime/opc";
import { spacing, tokenOptions, themeVersion } from "../runtime/tokens";
import { shellVariants } from "./shells";
export { spacing } from "../runtime/tokens";

/**
 * Page DSL versions. 0.2.0 adds business capabilities: `record.command` actions on the details panel
 * (capabilityRef + arguments + result) and `listDetail.dataSource` of type capability. 0.1.0 documents
 * are upgraded by the step in migrations.ts (their shape is a subset), so stored pages keep loading.
 */
export const versions = { pageSchema: "0.2.0", componentRegistry: "0.1.0", designTokens: themeVersion, codeGenerator: "0.2.0" } as const;
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
export const permissionKeys = ["delete", "move", "duplicate", "edit"] as const;
export type PermissionKey = (typeof permissionKeys)[number];
export type Permissions = Partial<Record<PermissionKey, boolean>>;
export const permissionsSchema = z.object({delete: z.boolean().optional(), move: z.boolean().optional(), duplicate: z.boolean().optional(), edit: z.boolean().optional()}).strict();
const primitive = z.union([z.string().max(1000), z.number().finite(), z.boolean()]);
/** A published business capability (opc-platform meta-data catalog), e.g. Library.Borrow. */
export const capabilityRefSchema = z.string().max(80).regex(capabilityRefPattern, "能力引用格式为 Domain.Name，例如 Library.Borrow");
const inputKey = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,39}$/);
/** Where one capability input comes from: the selected row, a field the user fills in before preview, or a constant. */
export const bindingSchema = z.discriminatedUnion("from", [
  z.object({from: z.literal("row"), field: z.string().min(1).max(40)}).strict(),
  z.object({from: z.literal("form"), label: z.string().min(1).max(40), type: z.enum(["text", "number"]), required: z.boolean().optional(), field: z.string().min(1).max(40).optional()}).strict(),
  z.object({from: z.literal("const"), value: primitive}).strict(),
]);
const noticeText = z.string().max(120);
export const commandActionSchema = z.object({
  event: z.literal("record.command"), capabilityRef: capabilityRefSchema, label: z.string().trim().min(1).max(20),
  arguments: z.record(inputKey, bindingSchema),
  /** true: PREVIEW → confirm → EXECUTE → receipt. false: EXECUTE directly (still idempotent). */
  confirm: z.boolean(),
  result: z.object({
    onSuccess: z.object({notice: noticeText.optional(), refresh: z.boolean(), receipt: z.array(z.object({key: inputKey, label: z.string().min(1).max(40)}).strict()).max(8).optional()}).strict(),
    onRejected: z.object({notice: noticeText.optional()}).strict(),
  }).strict(),
}).strict();
export const contextOpenActionSchema = z.object({event: z.literal("row.select"), capabilityRef: z.literal("context.open")}).strict();
export const actionSchema = z.union([contextOpenActionSchema, commandActionSchema]);
type ContextOpenAction = z.infer<typeof contextOpenActionSchema>;
export type { CommandAction };
export type PageNode = {
  id: string; componentRef: string; componentVersion: "0.1.0";
  props: Record<string, unknown>; layout: Layout; tokens: Tokens;
  responsive: { tablet?: Layout; mobile?: Layout };
  slots: Record<string, PageNode[]>;
  actions: (ContextOpenAction | CommandAction)[];
  meta: {locked: boolean; permissions?: Permissions};
};
export const nodeSchema: z.ZodType<PageNode> = z.lazy(() => z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
  componentRef: z.string().max(80), componentVersion: z.literal("0.1.0"),
  props: z.record(z.string(), z.unknown()), layout: layoutSchema, tokens: tokenSchema,
  responsive: z.object({tablet: layoutSchema.optional(), mobile: layoutSchema.optional()}).strict(),
  slots: z.record(z.string(), z.array(nodeSchema).max(500)),
  actions: z.array(actionSchema).max(4), meta: z.object({locked: z.boolean(), permissions: permissionsSchema.optional()}).strict(),
}).strict());
/** Rows from a published query capability; `rows` stay as example/offline data. fieldPaths: field key → dot path in a result row. */
export const capabilityDataSourceSchema: z.ZodType<CapabilityDataSource> = z.object({
  type: z.literal("capability"), capabilityRef: capabilityRefSchema,
  input: z.record(inputKey, primitive), idField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]{0,79}$/),
  fieldPaths: z.record(z.string(), z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]{0,79}$/)).optional(),
}).strict();
const fieldKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/).refine(key => !["id", "__proto__", "constructor", "prototype"].includes(key), "保留字段名");
export const listDetailSchema: z.ZodType<ListDetail> = z.object({
  entityName: z.string().min(1).max(20), dataSource: z.union([z.literal("example"), capabilityDataSourceSchema]),
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
  schemaVersion: z.literal(versions.pageSchema), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
  shell: z.object({variant: z.enum(shellVariants), version: z.literal("0.1.0"), workspaceName: z.string().min(1).max(40)}).strict(),
  root: z.array(nodeSchema).min(1).max(2),
  listDetail: listDetailSchema.optional(),
  dependencies: z.object({pageSchema: z.literal(versions.pageSchema), componentRegistry: z.literal(versions.componentRegistry), designTokens: z.literal(versions.designTokens), codeGenerator: z.literal(versions.codeGenerator)}).strict(),
}).strict();
export type PageDocument = z.infer<typeof pageSchema>;
export type Viewport = "desktop" | "tablet" | "mobile";
export const viewportWidths: Record<Viewport, number> = {desktop: 1440, tablet: 1024, mobile: 390};
