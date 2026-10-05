import type { Navigation } from "../runtime/components";
import { pageRoute } from "../ontology/model";
import { catalog } from "./ontology-store";

/** Sidebar navigation of the generated prototype: one entry per object type with a list page. */
export function appNavigation(activeType?: string): {navigation: Navigation; hasDetail: boolean; hasForm: boolean} {
  const types = catalog();
  const active = types.find(t => t.type.apiName === activeType);
  const navigation: Navigation = {
    items: types.filter(t => t.pages.some(p => p.kind === "list-detail")).map(t => ({
      label: t.type.pluralDisplayName ?? t.type.displayName, href: pageRoute(t.type.apiName, "list-detail"), count: t.count, active: t.type.apiName === activeType,
    })),
    links: [{label: "资源清单", href: "/resources"}, {label: "页面设计器", href: "/"}],
    ...(active?.pages.some(p => p.kind === "detail") ? {detailHref: `/apps/${active.type.apiName}/{id}`} : {}),
  };
  return {navigation, hasDetail: !!active?.pages.some(p => p.kind === "detail"), hasForm: !!active?.pages.some(p => p.kind === "form")};
}
