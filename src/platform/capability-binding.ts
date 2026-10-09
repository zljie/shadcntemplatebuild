import type { PageDocument, PageNode } from "../core/schema";
import type { ListDetail } from "../runtime/data";
import type { Binding, CapabilityDataSource, CapabilityInfo, CommandAction } from "../runtime/opc";
import type { Capability, Operation, Release } from "../server/opc-platform";

/**
 * Binds a list/detail page (Page DSL 0.2.0) to the business capabilities of a published release:
 * the list reads a query capability over the page's entity, the details panel offers the entity's commands.
 * Matching goes through the release's frozen operations (operation.entityId), so only published
 * capabilities are ever suggested.
 */
export type BindingSuggestion = { entityId: string; dataSource: CapabilityDataSource | null; commands: CommandAction[]; notes: string[] };

const snake = (key: string) => key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function operationsOf(cap: Capability, ops: Map<string, Operation>): Operation[] {
  const ids = cap.handler.type === "operation" ? [cap.handler.operationId] : cap.handler.dependencies.operations;
  return ids.flatMap(id => (ops.has(id) ? [ops.get(id)!] : []));
}

export function suggestBindings(release: Release, entityId: string, config: ListDetail, primaryKey: string): BindingSuggestion {
  const ops = new Map(release.operations.map(o => [o.operationId, o])), notes: string[] = [];
  const mapping = release.mappings.flatMap(m => m.entities).find(e => e.entityId === entityId);
  const column = (field: string) => mapping?.columns[field] ?? field;
  const touches = (cap: Capability) => operationsOf(cap, ops).filter(o => o.entityId === entityId);

  // List: prefer a pass-through list capability (one capability = one list operation), then a script over one.
  const lists = release.capabilities.filter(c => c.kind === "query" && touches(c).some(o => o.kind === "list"))
    .sort((a, b) => Number(b.handler.type === "operation") - Number(a.handler.type === "operation"));
  let dataSource: CapabilityDataSource | null = null;
  if (lists[0]) {
    const op = touches(lists[0]).find(o => o.kind === "list")!;
    const fieldPaths = Object.fromEntries(config.fields.flatMap(f => (column(f.key) !== f.key ? [[f.key, column(f.key)]] : [])));
    dataSource = { type: "capability", capabilityRef: lists[0].capabilityRef, input: {}, idField: column(primaryKey), ...(Object.keys(fieldPaths).length ? { fieldPaths } : {}) };
    const selected = new Set(op.document.match(/^\s+([a-z_][a-z0-9_]*)\s*$/gm)?.map(s => s.trim()) ?? []);
    const absent = config.fields.filter(f => !selected.has(column(f.key))).map(f => f.key);
    if (absent.length) notes.push(`${lists[0].capabilityRef} 不返回字段：${absent.join("、")}（显示为空）`);
    if (lists.length > 1) notes.push(`另有可选列表能力：${lists.slice(1).map(c => c.capabilityRef).join("、")}`);
  } else notes.push(`发布中没有 ${entityId} 的列表查询能力，列表继续使用示例数据`);

  const fields = new Map(config.fields.map(f => [f.key, f]));
  const commands = release.capabilities.filter(c => c.kind === "command" && touches(c).length).slice(0, 4).map((cap): CommandAction => {
    const schema = isObject(cap.inputSchema) ? cap.inputSchema : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    const properties = isObject(schema.properties) ? schema.properties : {};
    const args: Record<string, Binding> = {};
    for (const [key, raw] of Object.entries(properties)) {
      const name = fields.has(key) ? key : fields.has(snake(key)) ? snake(key) : null;
      const prop = isObject(raw) ? raw : {};
      const type = [prop.type].flat().includes("integer") || [prop.type].flat().includes("number") ? "number" : "text";
      if (name === primaryKey) args[key] = { from: "row", field: name };
      else if (name) args[key] = { from: "form", label: fields.get(name)!.label, type, field: name, ...(required.has(key) && ![prop.type].flat().includes("null") ? { required: true } : {}) };
      else args[key] = { from: "form", label: key, type, ...(required.has(key) ? { required: true } : {}) };
    }
    const output = isObject(cap.outputSchema) && isObject(cap.outputSchema.properties) ? Object.keys(cap.outputSchema.properties) : [];
    return {
      event: "record.command", capabilityRef: cap.capabilityRef, label: (cap.title ?? cap.capabilityRef.split(".").at(-1)!).replace(/（.*?）/g, "").slice(0, 20),
      arguments: args, confirm: cap.handler.type === "script",
      result: { onSuccess: { refresh: true, ...(output.length ? { receipt: output.slice(0, 8).map(key => ({ key, label: key })) } : {}) }, onRejected: {} },
    };
  });
  return { entityId, dataSource, commands, notes };
}

const mapNodes = (nodes: PageNode[], visit: (node: PageNode) => PageNode): PageNode[] =>
  nodes.map(node => { const next = visit(node); return { ...next, slots: Object.fromEntries(Object.entries(next.slots).map(([k, v]) => [k, mapNodes(v, visit)])) }; });

/** Writes the suggestion into the page DSL: data source on listDetail, commands on the details panel. */
export function applyBindings(document: PageDocument, suggestion: Pick<BindingSuggestion, "dataSource" | "commands">): PageDocument {
  if (!document.listDetail) return document;
  return {
    ...document,
    listDetail: { ...document.listDetail, dataSource: suggestion.dataSource ?? "example" },
    root: mapNodes(document.root, node => node.componentRef === "composite.resource-details"
      ? { ...node, actions: [...node.actions.filter(a => a.event !== "record.command"), ...suggestion.commands] } : node),
  };
}

/** Capability references of a page checked against what a release actually publishes (kind, input keys, required inputs). */
export function checkCapabilityRefs(document: PageDocument, capabilities: CapabilityInfo[]): { path: string; message: string }[] {
  const byRef = new Map(capabilities.map(c => [c.capabilityRef, c])), issues: { path: string; message: string }[] = [];
  const check = (path: string, ref: string, kind: "query" | "command", keys: string[]) => {
    const cap = byRef.get(ref);
    if (!cap) return issues.push({ path, message: `能力 ${ref} 未在当前发布中` });
    if (cap.kind !== kind) return issues.push({ path, message: `能力 ${ref} 是 ${cap.kind}，这里需要 ${kind}` });
    const schema = isObject(cap.inputSchema) ? cap.inputSchema : {};
    const properties = isObject(schema.properties) ? Object.keys(schema.properties) : null;
    if (properties && schema.additionalProperties === false) for (const key of keys.filter(k => !properties.includes(k))) issues.push({ path, message: `能力 ${ref} 没有输入 ${key}` });
    if (kind === "command" && Array.isArray(schema.required)) for (const key of schema.required.map(String).filter(k => !keys.includes(k))) issues.push({ path, message: `能力 ${ref} 的必填输入 ${key} 没有绑定` });
  };
  const source = document.listDetail?.dataSource;
  if (source && typeof source === "object") check("listDetail.dataSource", source.capabilityRef, "query", Object.keys(source.input));
  const visit = (nodes: PageNode[]) => nodes.forEach(node => {
    node.actions.forEach((action, i) => { if (action.event === "record.command") check(`node.${node.id}.actions.${i}`, action.capabilityRef, "command", Object.keys(action.arguments)); });
    Object.values(node.slots).forEach(visit);
  });
  visit(document.root);
  return issues;
}
