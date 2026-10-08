import type { Metadata } from "next";
import { connection } from "next/server";
import { listBusinessModels } from "@/server/business-model-store";
import { BusinessModelList } from "@/business-model/list";

export const metadata: Metadata = { title: "业务建模 — Composer", description: "导入本体 YAML，管理并设计业务模型" };

export default async function BusinessModelsPage() {
  await connection();
  return <BusinessModelList models={listBusinessModels()} />;
}
