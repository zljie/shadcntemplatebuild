import type { Metadata } from "next";
import { connection } from "next/server";
import { Boxes } from "lucide-react";
import { Empty, PlatformFrame } from "@/platform/frame";
import { OperationCatalog } from "@/platform/operation-catalog";
import { activeRelease, healthAll, listOperations, opcConfig } from "@/server/opc-platform";

export const metadata: Metadata = { title: "Operation 目录 — Composer", description: "已登记的 GraphQL Operation：角色、文档 hash 与启用状态" };

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ package?: string }> }) {
  await connection();
  const config = opcConfig(), { package: pkgParam } = await searchParams;
  const [health, release] = await Promise.all([healthAll(config), activeRelease(config)]);
  const [id, version] = pkgParam?.split("@") ?? [];
  const pkg = id && version ? { id, version } : release?.packageRef;
  const operations = pkg ? await listOperations(pkg, config) : null;
  return <PlatformFrame active="/platform/operations" config={config} health={health} eyebrow={<><Boxes size={14}/> OPERATION CATALOG · META-DATA</>} title="Operation 目录"
    description={`由 db-connect 从映射和模型 Action 编译、登记在 meta-data 的固定 GraphQL 文档。脚本和直通能力只能按 operationId 调用这里的文档，BFF 拒绝未登记或未声明的调用。${pkg ? `模型包 ${pkg.id}@${pkg.version}。` : ""}`}>
    {operations ? <OperationCatalog operations={operations} inRelease={release?.operations.map(o => o.operationId) ?? []} releaseId={release?.id ?? null}/>
      : <div className="platform-card"><Empty>{pkg ? "meta-data 不可达" : "没有已启用的发布；可用 ?package=id@version 指定模型包"}</Empty></div>}
  </PlatformFrame>;
}
