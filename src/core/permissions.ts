import { registry } from "./registry";
import {
  permissionKeys,
  type PermissionKey,
  type PageDocument,
  type PageNode,
  type Permissions,
} from "./schema";

/**
 * Three layers, later wins: global defaults → component (registry `permissions`) → node
 * (`meta.permissions`, set by a human in the inspector). Locked Shell regions can never be
 * deleted, moved or duplicated, whatever the lower layers say.
 */
export type ResolvedPermissions = Record<PermissionKey, boolean>;
export const globalPermissions: ResolvedPermissions = {
  delete: true,
  move: true,
  duplicate: true,
  edit: true,
};
export const permissionLabels: Record<PermissionKey, string> = {
  delete: "删除",
  move: "移动",
  duplicate: "复制",
  edit: "编辑属性",
};

export function resolvePermissions(node: PageNode): ResolvedPermissions {
  const resolved: ResolvedPermissions = {
    ...globalPermissions,
    ...registry[node.componentRef]?.permissions,
    ...node.meta.permissions,
  };
  if (node.meta.locked)
    Object.assign(resolved, { delete: false, move: false, duplicate: false });
  return resolved;
}

export const can = (node: PageNode, action: PermissionKey) =>
  resolvePermissions(node)[action];

export function permissionError(
  node: PageNode,
  action: PermissionKey,
): string | null {
  if (can(node, action)) return null;
  const name = registry[node.componentRef]?.name ?? node.componentRef;
  return node.meta.locked && action !== "edit"
    ? `锁定的 Shell 区域不能${permissionLabels[action]}`
    : `${name} 已禁止${permissionLabels[action]}`;
}

/** Drop keys equal to what the component layer already gives, so documents only store real overrides. */
export function normalizePermissions(
  node: PageNode,
  next: Permissions,
): Permissions | undefined {
  const base: ResolvedPermissions = {
    ...globalPermissions,
    ...registry[node.componentRef]?.permissions,
  };
  const out: Permissions = {};
  for (const key of permissionKeys)
    if (next[key] !== undefined && next[key] !== base[key])
      out[key] = next[key];
  return Object.keys(out).length ? out : undefined;
}

type Placed = { node: PageNode; parent?: string; slot?: string };
function index(document: PageDocument): Map<string, Placed> {
  const map = new Map<string, Placed>();
  const visit = (nodes: PageNode[], parent?: string, slot?: string) => {
    for (const node of nodes) {
      map.set(node.id, { node, parent, slot });
      for (const [key, children] of Object.entries(node.slots))
        visit(children, node.id, key);
    }
  };
  visit(document.root);
  return map;
}
const content = (node: PageNode) =>
  JSON.stringify([
    node.componentRef,
    node.props,
    node.layout,
    node.tokens,
    node.responsive,
    Object.keys(node.slots).sort(),
    node.actions,
  ]);

/**
 * Checked on the result of every command (human, AI and MCP alike), using the permissions in force
 * BEFORE the command. Comparing outcomes instead of individual steps lets an AI rebuild a region
 * (remove + re-insert) as long as protected nodes come back unchanged and in the same slot.
 */
export function permissionIssues(
  before: PageDocument,
  after: PageDocument,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const next = index(after);
  for (const [id, placed] of index(before)) {
    const perms = resolvePermissions(placed.node);
    const found = next.get(id);
    const path = `node.${id}`;
    if (!found) {
      // Root Shell regions come and go with page.shell; the structural validator guards them.
      if (placed.node.meta.locked && !placed.parent) continue;
      if (!perms.delete)
        issues.push({ path, message: permissionError(placed.node, "delete")! });
      continue;
    }
    if (
      !perms.move &&
      (found.parent !== placed.parent || found.slot !== placed.slot)
    )
      issues.push({ path, message: permissionError(placed.node, "move")! });
    if (!perms.edit && content(found.node) !== content(placed.node))
      issues.push({ path, message: permissionError(placed.node, "edit")! });
  }
  return issues;
}
