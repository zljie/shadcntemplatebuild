import type { Release } from "../server/opc-platform";

// Key-order independent JSON (kept local: this module also runs in the browser, the generator pulls in prettier).
const stableStringify = (value: unknown): string => Array.isArray(value) ? `[${value.map(stableStringify).join(",")}]`
  : value !== null && typeof value === "object" ? `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`
  : JSON.stringify(value);

export type DiffEntry = { key: string; change: "added" | "removed" | "changed"; detail?: string };
export type ReleaseDiff = { package: string | null; sections: { name: string; label: string; entries: DiffEntry[] }[]; same: boolean };

function diffBy<T>(base: T[], target: T[], key: (item: T) => string, detail: (a: T, b: T) => string | undefined): DiffEntry[] {
  const before = new Map(base.map(item => [key(item), item])), after = new Map(target.map(item => [key(item), item]));
  const entries: DiffEntry[] = [];
  for (const [k, item] of after) {
    const old = before.get(k);
    if (!old) entries.push({ key: k, change: "added" });
    else if (stableStringify(old) !== stableStringify(item)) entries.push({ key: k, change: "changed", detail: detail(old, item) });
  }
  for (const k of before.keys()) if (!after.has(k)) entries.push({ key: k, change: "removed" });
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
const changedFields = (a: object, b: object) => Object.keys({ ...a, ...b }).filter(k => stableStringify((a as Record<string, unknown>)[k]) !== stableStringify((b as Record<string, unknown>)[k])).join("、");

/** What `target` changes compared with `base` (usually the active release): package, operations, capabilities, mappings, bindings, actions. */
export function diffReleases(base: Release, target: Release): ReleaseDiff {
  const pkg = base.packageRef.version !== target.packageRef.version || base.packageRef.id !== target.packageRef.id || base.packageDigest !== target.packageDigest
    ? `${base.packageRef.id}@${base.packageRef.version} → ${target.packageRef.id}@${target.packageRef.version}${base.packageDigest !== target.packageDigest ? "（内容摘要不同）" : ""}` : null;
  const sections = [
    { name: "operations", label: "Operation", entries: diffBy(base.operations, target.operations, o => o.operationId, (a, b) => a.documentSha256 !== b.documentSha256 ? `文档 hash ${a.documentSha256.slice(7, 15)} → ${b.documentSha256.slice(7, 15)}` : changedFields(a, b)) },
    { name: "capabilities", label: "能力", entries: diffBy(base.capabilities, target.capabilities, c => c.capabilityRef, changedFields) },
    { name: "mappings", label: "数据映射", entries: diffBy(base.mappings, target.mappings, m => m.id, (a, b) => changedFields(a, b)) },
    { name: "bindings", label: "行为绑定", entries: diffBy(base.bindings, target.bindings, b => b.id, changedFields) },
    { name: "actions", label: "模型 Action", entries: diffBy(base.actions, target.actions, a => a, () => undefined) },
  ];
  return { package: pkg, sections, same: !pkg && sections.every(s => !s.entries.length) && base.manifestDigest === target.manifestDigest };
}
