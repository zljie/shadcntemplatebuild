import type { Metadata } from "next";
import { connection } from "next/server";
import { catalog, getPage, listPages } from "@/server/ontology-store";
import { getTemplate, listTemplates } from "@/core/templates";
import { pageRoute } from "@/ontology/model";
import { ProjectsHome, type DesignItem, type LayoutUsage } from "@/prototype/projects";

export const metadata: Metadata = { title: "我的项目 — Composer", description: "页面设计、应用框架与布局模式总览" };

export default async function ProjectsPage() {
  await connection();
  const types = catalog();
  const typeName = new Map(types.map((t) => [t.type.apiName, t.type.pluralDisplayName ?? t.type.displayName]));
  const pages = listPages();
  const database: DesignItem[] = pages.flatMap((page) => {
    const document = page.kind === "list-detail" ? getPage(page.id)?.document : null;
    if (!document) return [];
    return [{
      key: `page:${page.id}`, origin: "database", name: page.name, description: `${typeName.get(page.objectType) ?? page.objectType} 数据模型 · ${document.listDetail?.fields.length ?? 0} 个字段`,
      updatedAt: page.updatedAt, document, openHref: `/editor?page=${encodeURIComponent(page.id)}`, runHref: pageRoute(page.objectType, "list-detail"), tags: [typeName.get(page.objectType) ?? page.objectType],
    }];
  });
  const templates = (await Promise.all((await listTemplates()).map((meta) => getTemplate(meta.id)))).flatMap((t): DesignItem[] => t ? [{
    key: `template:${t.id}`, origin: "template", name: t.name, description: t.description, updatedAt: t.updatedAt, document: t.document,
    openHref: `/editor?template=${encodeURIComponent(t.id)}`, tags: t.tags,
  }] : []);
  const layouts: LayoutUsage = Object.fromEntries((["list-detail", "detail", "form"] as const).map((kind) => [kind, pages.filter((p) => p.kind === kind).map((p) => {
    const sample = types.find((t) => t.type.apiName === p.objectType)?.sampleId;
    return { name: p.name, href: kind === "detail" ? (sample ? pageRoute(p.objectType, "detail", sample) : null) : pageRoute(p.objectType, kind) };
  })])) as LayoutUsage;
  const apps = types.filter((t) => t.pages.some((p) => p.kind === "list-detail")).map((t) => ({ name: typeName.get(t.type.apiName)!, href: pageRoute(t.type.apiName, "list-detail"), count: t.count }));
  return <ProjectsHome designs={[...database, ...templates]} layouts={layouts} apps={apps} modelCount={types.length} />;
}
