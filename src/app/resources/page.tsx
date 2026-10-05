import type { Metadata } from "next";
import { connection } from "next/server";
import { catalog, listPages } from "@/server/ontology-store";
import { listTemplates } from "@/core/templates";
import { databasePath } from "@/server/db";
import { ResourceCatalog } from "@/prototype/catalog";

export const metadata: Metadata = { title: "资源清单 — Composer", description: "数据模型、页面与模板的统一清单" };

export default async function ResourcesPage() {
  await connection();
  const file = databasePath();
  return <ResourceCatalog objectTypes={catalog()} pages={listPages()} templates={await listTemplates()} database={file === ":memory:" ? file : file.replace(process.cwd() + "/", "")} />;
}
