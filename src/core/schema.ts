import { z } from "zod";

export const versions = { pageSchema: "0.1.0", componentRegistry: "0.1.0", designTokens: "provisional-0.1.0", codeGenerator: "0.1.0" } as const;
export const spacing = ["space.0", "space.2", "space.3", "space.4", "space.6", "space.8"] as const;
export const layoutSchema = z.object({
  direction: z.enum(["column", "row"]).optional(),
  gap: z.enum(spacing).optional(),
  padding: z.enum(spacing).optional(),
  width: z.enum(["width.full", "width.auto"]).optional(),
  align: z.enum(["start", "center", "stretch"]).optional(),
  hidden: z.boolean().optional(),
}).strict();
export const tokenSchema = z.object({
  surface: z.enum(["color.surface", "color.muted"]).optional(),
  radius: z.enum(["radius.sm", "radius.md", "radius.lg"]).optional(),
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
export const pageSchema = z.object({
  schemaVersion: z.literal("0.1.0"), id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
  shell: z.object({variant: z.literal("contextual"), version: z.literal("0.1.0"), workspaceName: z.string().min(1).max(40)}).strict(),
  root: z.array(nodeSchema).length(2),
  dependencies: z.object({pageSchema: z.literal(versions.pageSchema), componentRegistry: z.literal(versions.componentRegistry), designTokens: z.literal(versions.designTokens), codeGenerator: z.literal(versions.codeGenerator)}).strict(),
}).strict();
export type PageDocument = z.infer<typeof pageSchema>;
export type Viewport = "desktop" | "tablet" | "mobile";
export const viewportWidths: Record<Viewport, number> = {desktop: 1440, tablet: 1024, mobile: 390};
