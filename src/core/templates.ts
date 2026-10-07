import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { validateDocument, type Issue } from "./validation";
import { upgradeDocument } from "./migrations";
import type { PageDocument } from "./schema";

/**
 * File-backed template library shared by the builder (via /api/templates), the MCP server and
 * the shadcn registry build. One JSON file per template under TEMPLATES_DIR (default ./templates).
 * Every write is validated with the same validateDocument used everywhere else.
 */
export const templateIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const templateMetaSchema = z.object({
  id: z
    .string()
    .regex(templateIdPattern, "模板 ID 只能包含小写字母、数字和连字符"),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(""),
  tags: z.array(z.string().trim().min(1).max(20)).max(10).default([]),
});
export type TemplateMeta = z.infer<typeof templateMetaSchema> & {
  updatedAt: string;
  source: "builder" | "seed" | "ai" | "mcp";
};
export type Template = TemplateMeta & { document: PageDocument };
export type SaveTemplateInput = z.input<typeof templateMetaSchema> & {
  document: unknown;
  source?: TemplateMeta["source"];
};
export type SaveResult =
  { ok: true; template: Template } | { ok: false; errors: Issue[] };

export function templatesDir(): string {
  return process.env.TEMPLATES_DIR
    ? path.resolve(process.env.TEMPLATES_DIR)
    : path.join(process.cwd(), "templates");
}
function fileFor(id: string): string {
  if (!templateIdPattern.test(id)) throw new Error("无效的模板 ID");
  return path.join(templatesDir(), `${id}.json`);
}

async function readTemplateFile(file: string): Promise<Template | null> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Template;
    const value = { ...raw, document: upgradeDocument(raw?.document) as PageDocument };
    const meta = templateMetaSchema.safeParse(value);
    if (!meta.success || validateDocument(value.document).length) return null;
    return { ...value, ...meta.data };
  } catch {
    return null;
  }
}

export function withoutDocument(template: Template): TemplateMeta {
  const meta: Partial<Template> = { ...template };
  delete meta.document;
  return meta as TemplateMeta;
}

export async function listTemplates(): Promise<TemplateMeta[]> {
  let names: string[] = [];
  try {
    names = (await readdir(templatesDir())).filter((name) =>
      name.endsWith(".json"),
    );
  } catch {
    return [];
  }
  const templates = await Promise.all(
    names.map((name) => readTemplateFile(path.join(templatesDir(), name))),
  );
  return templates
    .filter((t): t is Template => !!t)
    .map(withoutDocument)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function getTemplate(id: string): Promise<Template | null> {
  if (!templateIdPattern.test(id)) return null;
  return readTemplateFile(fileFor(id));
}

export async function saveTemplate(
  input: SaveTemplateInput,
): Promise<SaveResult> {
  const meta = templateMetaSchema.safeParse(input);
  if (!meta.success)
    return {
      ok: false,
      errors: meta.error.issues.map((e) => ({
        path: e.path.join("."),
        message: e.message,
      })),
    };
  const document = upgradeDocument(input.document);
  const errors = validateDocument(document);
  if (errors.length) return { ok: false, errors };
  const template: Template = {
    ...meta.data,
    source: input.source ?? "builder",
    updatedAt: new Date().toISOString(),
    document: document as PageDocument,
  };
  await mkdir(templatesDir(), { recursive: true });
  const file = fileFor(template.id);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, JSON.stringify(template, null, 2) + "\n", "utf8");
  await rename(temporary, file);
  return { ok: true, template };
}

export async function deleteTemplate(id: string): Promise<boolean> {
  if (!(await getTemplate(id))) return false;
  await rm(fileFor(id));
  return true;
}
