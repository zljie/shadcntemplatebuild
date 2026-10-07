import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { commandSchema, execute, type Command } from "./commands";
import { componentSources, registry } from "./registry";
import { validateDocument, walk, type Issue } from "./validation";
import { upgradeDocument } from "./migrations";
import type { PageDocument, PageNode } from "./schema";

/**
 * Server-side operations shared by the MCP server and the in-editor LLM chat.
 * Nothing here talks to a model; everything goes through the same validator / command engine
 * the human editor uses, so AI output can never bypass Registry, Slot or Shell rules.
 */

export type ApplyResult =
  | { ok: true; document: PageDocument; inverse: Command }
  | { ok: false; errors: Issue[] };

/** Apply a list of commands atomically (as one batch). Returns the new document or path/message errors. */
export function applyCommands(
  input: unknown,
  commands: unknown,
): ApplyResult {
  const document = upgradeDocument(input);
  const documentIssues = validateDocument(document);
  if (documentIssues.length)
    return {
      ok: false,
      errors: documentIssues.map((e) => ({ ...e, path: `document.${e.path}` })),
    };
  const parsed = z.array(commandSchema).min(1).max(100).safeParse(commands);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((e) => ({
        path: `commands.${e.path.join(".")}`,
        message: e.message,
      })),
    };
  const doc = document as PageDocument;
  const command: Command =
    parsed.data.length === 1
      ? parsed.data[0]
      : { type: "batch", commands: parsed.data };
  const result = execute(doc, 0, {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor: { type: "agent", id: "mcp" },
    pageId: doc.id,
    baseRevision: 0,
    command,
  });
  if (!result.success) return { ok: false, errors: result.errors };
  const policy = agentPolicyIssues(doc, result.document);
  if (policy.length) return { ok: false, errors: policy };
  return { ok: true, document: result.document, inverse: result.inverseCommand };
}

/** Components an AI may use: every registered component not marked ai.exclude. */
export const aiComponents = () =>
  Object.entries(registry).filter(([, d]) => !d.ai?.exclude);

/**
 * Rules that only bind AI edits (chat agent and MCP), on top of the shared command engine:
 * ai.exclude components cannot be added, ai.excludeFields props cannot change, and node
 * permissions (meta.permissions) are a human decision.
 */
export function agentPolicyIssues(before: PageDocument, after: PageDocument): Issue[] {
  const previous = new Map<string, PageNode>();
  walk(before.root, (node) => previous.set(node.id, node));
  const issues: Issue[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  walk(after.root, (node) => {
    const d = registry[node.componentRef];
    if (!d) return;
    const existing = previous.get(node.id);
    const kept = existing?.componentRef === node.componentRef ? existing : undefined;
    const path = `node.${node.id}`;
    if (d.ai?.exclude && !kept)
      issues.push({ path, message: `${d.name} 不对 AI 开放，请改用其他组件` });
    for (const key of d.ai?.excludeFields ?? [])
      if (!same(node.props[key], kept ? kept.props[key] : d.defaults[key]))
        issues.push({ path: `${path}.props.${key}`, message: `${d.name} 的 ${key} 不允许由 AI 修改，请保持原值` });
    if (!same(node.meta.permissions, kept?.meta.permissions))
      issues.push({ path: `${path}.meta.permissions`, message: "节点权限只能由人在编辑器中设置" });
  });
  return issues;
}

/** Compact, token-cheap catalogue: enough for an AI to choose components; full detail via describeComponent. */
export function componentSummaries() {
  return aiComponents().map(([componentRef, d]) => ({
    componentRef,
    name: d.name,
    description: d.description,
    ai: d.ai,
    category: d.category,
    internal: !!d.internal,
    props: Object.keys(d.defaults),
    slots: Object.fromEntries(
      Object.entries(d.slots).map(([key, slot]) => [
        key,
        { accepts: slot.accepts, max: slot.max },
      ]),
    ),
    parents: d.parents,
  }));
}

/** Source files backing one componentRef (its adapter module plus transitive shadcn UI files). */
export async function componentSource(
  componentRef: string,
  root = process.cwd(),
) {
  const definition = registry[componentRef];
  if (!definition) return null;
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (symbol: string) => {
    if (seen.has(symbol)) return;
    seen.add(symbol);
    const source = componentSources[symbol];
    if (!source) return;
    source.files.forEach((file) => files.add(file));
    source.componentDependencies.forEach(visit);
  };
  visit(definition.exportName);
  const npm = new Set<string>();
  for (const symbol of seen)
    componentSources[symbol]?.npmDependencies.forEach((dep) => npm.add(dep));
  const contents = await Promise.all(
    [...files]
      .sort()
      .map(async (file) => ({
        path: file,
        content: await readFile(path.join(root, file), "utf8"),
      })),
  );
  return {
    componentRef,
    exportName: definition.exportName,
    importPath: definition.importPath,
    symbols: [...seen].sort(),
    npmDependencies: [...npm].sort(),
    files: contents,
    note: "src/runtime/components.tsx is the shared runtime module: it exports every block, so it is returned whole. Install the whole runtime with the shadcn registry item `shadcnplane-runtime` instead of copying single symbols.",
  };
}
