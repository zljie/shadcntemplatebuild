import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadRecordPage } from "@/prototype/load";
import { RecordDetailApp } from "@/prototype/app-pages";

type Props = { params: Promise<{ type: string; id: string }> };

export default async function RecordDetailPage({ params }: Props) {
  await connection();
  const { type, id } = await params;
  const data = loadRecordPage(type, "detail", decodeURIComponent(id));
  if (!data?.record) notFound();
  return <RecordDetailApp objectType={type} config={data.config} record={data.record} linkTargets={data.linkTargets} incoming={data.incoming} navigation={data.navigation} canEdit={data.hasForm} listTitle={data.listTitle} workspaceName={data.workspaceName} />;
}
