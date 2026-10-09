import type { Metadata } from "next";
import { connection } from "next/server";
import { DatabaseZap } from "lucide-react";
import { Empty, PlatformFrame } from "@/platform/frame";
import { MappingView } from "@/platform/mapping-view";
import { activeRelease, getRelease, healthAll, opcConfig } from "@/server/opc-platform";

export const metadata: Metadata = { title: "数据映射 — Composer", description: "模型字段到表列的映射、编译出的 Operation 与 Hasura 同步状态" };

export default async function MappingsPage({ searchParams }: { searchParams: Promise<{ release?: string }> }) {
  await connection();
  const config = opcConfig(), { release: id } = await searchParams;
  const [health, release] = await Promise.all([healthAll(config), id ? getRelease(id, config) : activeRelease(config)]);
  const db = health.find(h => h.service === "db-connect");
  return <PlatformFrame active="/platform/mappings" config={config} health={health} eyebrow={<><DatabaseZap size={14}/> DATA MAPPING · DB-CONNECT</>} title="数据映射"
    description="映射把模型对象和字段对应到 PostgreSQL 表和列。db-connect 按映射与模型 Action 的授权编译 Hasura 元数据（行列权限、allowlist）和固定的 Operation 文档；权限只来自模型。">
    {release ? <MappingView release={release} hasura={db?.ok ? Boolean(db.detail?.hasura) : null}/> : <div className="platform-card"><Empty>{id ? `发布 ${id} 不存在` : "没有已启用的发布，先在发布中心启用一个"}</Empty></div>}
  </PlatformFrame>;
}
