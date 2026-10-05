import { getObject, getObjectType, getPage, incomingLinks, runtimeConfig } from "../server/ontology-store";
import { appNavigation } from "../server/navigation";
import { pageId, type PageKind } from "../ontology/model";

/** Loads what a generated detail/form page needs; null when the type, page or record does not exist. */
export function loadRecordPage(type: string, kind: PageKind, id?: string) {
  const objectType = getObjectType(type), config = runtimeConfig(type);
  if (!objectType || !config || !getPage(pageId(type, kind))) return null;
  const found = id === undefined ? null : getObject(type, id);
  if (id !== undefined && !found) return null;
  const { navigation, hasDetail, hasForm } = appNavigation(type);
  return {
    objectType, config, record: found?.record, navigation, hasDetail, hasForm,
    listTitle: objectType.pluralDisplayName ?? objectType.displayName,
    workspaceName: getPage(pageId(type, "list-detail"))?.document?.shell.workspaceName ?? "Acme Workspace",
    linkTargets: Object.fromEntries(objectType.properties.flatMap((p) => (p.baseType === "link" && p.target ? [[p.apiName, p.target]] : []))) as Record<string, string>,
    incoming: id === undefined ? [] : incomingLinks(type, id).map((g) => ({ ...g, type: { apiName: g.type.apiName, displayName: g.type.displayName } })),
  };
}
