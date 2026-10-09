import { pageId, pageRoute } from "../ontology/model";
import { applyBindings, checkCapabilityRefs, suggestBindings, type BindingSuggestion } from "../platform/capability-binding";
import { getBusinessModel, listBusinessModels } from "./business-model-store";
import { getObjectType, hydratedListDetailDocument, savePageDocument } from "./ontology-store";
import type { Release } from "./opc-platform";

/**
 * List/detail pages that can bind to a release: pages of object types projected from a business-model
 * entity that the release maps (business model binding entity → object type).
 */
export type BindingCandidate = {
  pageId: string; objectType: string; entityId: string; model: string; name: string; href: string;
  current: {dataSource: string | null; commands: string[]}; suggestion: BindingSuggestion; issues: {path: string; message: string}[];
};

export function bindingCandidates(release: Release): BindingCandidate[] {
  const mapped = new Set(release.mappings.flatMap(m => m.entities.map(e => e.entityId)));
  const models = listBusinessModels().sort((a, b) => Number(b.id === release.packageRef.id) - Number(a.id === release.packageRef.id));
  const seen = new Set<string>(), result: BindingCandidate[] = [];
  for (const summary of models) {
    const model = getBusinessModel(summary.id)?.model;
    for (const [entityId, binding] of Object.entries(model?.bindings ?? {})) {
      if (!mapped.has(entityId) || seen.has(binding.objectType)) continue;
      const type = getObjectType(binding.objectType), document = type && hydratedListDetailDocument(type.apiName);
      if (!type || !document?.listDetail) continue;
      seen.add(binding.objectType);
      const source = document.listDetail.dataSource;
      const commands: string[] = [];
      const visit = (nodes: typeof document.root) => nodes.forEach(n => { n.actions.forEach(a => { if (a.event === "record.command") commands.push(a.capabilityRef); }); Object.values(n.slots).forEach(visit); });
      visit(document.root);
      result.push({
        pageId: pageId(type.apiName, "list-detail"), objectType: type.apiName, entityId, model: summary.name, name: document.name, href: pageRoute(type.apiName, "list-detail"),
        current: {dataSource: typeof source === "object" ? source.capabilityRef : null, commands},
        suggestion: suggestBindings(release, entityId, document.listDetail, type.primaryKey),
        issues: checkCapabilityRefs(document, release.capabilities),
      });
    }
  }
  return result;
}

/** Writes the suggested capability bindings into the stored page DSL (validated like any composer save). */
type Result<T> = {ok: true; value: T} | {ok: false; errors: {path: string; message: string}[]};
export function bindPage(release: Release, page: string, mode: "bind" | "unbind" = "bind"): Result<{name: string}> {
  const candidate = bindingCandidates(release).find(c => c.pageId === page);
  if (!candidate) return {ok: false, errors: [{path: "pageId", message: "页面不存在，或其业务对象不在该发布的数据映射中"}]};
  const document = hydratedListDetailDocument(candidate.objectType)!;
  const next = applyBindings(document, mode === "bind" ? candidate.suggestion : {dataSource: null, commands: []});
  const saved = savePageDocument(page, next);
  return saved.ok ? {ok: true, value: {name: document.name}} : saved;
}
