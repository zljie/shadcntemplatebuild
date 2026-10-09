import type { Metadata } from "next";
import { connection } from "next/server";
import { FlaskConical } from "lucide-react";
import { PlatformFrame } from "@/platform/frame";
import { CapabilityRunner } from "@/platform/capability-runner";
import { activeRelease, healthAll, opcConfig } from "@/server/opc-platform";

export const metadata: Metadata = { title: "能力试运行 — Composer", description: "按输入 Schema 填写参数、选择开发身份，对 BFF 预览或执行已发布能力" };

export default async function TryPage() {
  await connection();
  const config = opcConfig();
  const [health, release] = await Promise.all([healthAll(config), activeRelease(config)]);
  return <PlatformFrame active="/platform/try" config={config} health={health} eyebrow={<><FlaskConical size={14}/> CAPABILITY · BFF</>} title="能力试运行"
    description="选择当前启用发布中的能力，按输入 Schema 自动生成表单，选一个开发身份，然后预览（PREVIEW，不写入）或执行（命令需要 Idempotency-Key）。结果是 BFF 的统一能力结果：SUCCEEDED / REJECTED / FAILED / PENDING 及原因。">
    <CapabilityRunner capabilities={release?.capabilities ?? []} releaseId={release?.id ?? null}/>
  </PlatformFrame>;
}
