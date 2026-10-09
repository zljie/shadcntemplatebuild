import type { Metadata } from "next";
import { connection } from "next/server";
import { Rocket } from "lucide-react";
import { PlatformFrame } from "@/platform/frame";
import { ReleaseCenter } from "@/platform/release-center";
import { activeRelease, getRelease, healthAll, knownReleases, opcConfig } from "@/server/opc-platform";
import { bindingCandidates } from "@/server/platform-bindings";

export const metadata: Metadata = { title: "发布中心 — Composer", description: "opc-platform 发布清单、差异、阻塞项与启用" };

export default async function ReleasesPage() {
  await connection();
  const config = opcConfig();
  const [health, active] = await Promise.all([healthAll(config), activeRelease(config)]);
  const ids = config.app ? knownReleases(config.app).map(r => r.id) : [];
  if (active && !ids.includes(active.id)) ids.unshift(active.id);
  const releases = await Promise.all(ids.map(async id => ({ id, release: id === active?.id ? active : await getRelease(id, config) })));
  return <PlatformFrame active="/platform/releases" config={config} health={health} eyebrow={<><Rocket size={14}/> RELEASE · META-DATA</>} title="发布中心"
    description="一个发布冻结一组模型包、数据映射、行为绑定、Operation 和能力。两端（db-connect、BFF）报告就绪后才能启用；启用后 BFF 只服务这个发布。">
    <ReleaseCenter releases={releases} activeId={active?.id ?? null} candidates={active ? bindingCandidates(active) : []}/>
  </PlatformFrame>;
}
