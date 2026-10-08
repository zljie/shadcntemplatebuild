import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getBusinessModel } from "@/server/business-model-store";
import { BusinessModelWorkspace } from "@/business-model/workspace";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `${(await params).id} — 业务建模` };
}

export default async function BusinessModelPage({ params, searchParams }: Props) {
  await connection();
  const stored = getBusinessModel((await params).id);
  if (!stored) notFound();
  const query = await searchParams, one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return <BusinessModelWorkspace stored={stored} initialTab={one(query.tab)} initialEntity={one(query.entity)} />;
}
