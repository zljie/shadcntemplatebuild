import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadRecordPage } from "@/prototype/load";
import { RecordFormApp } from "@/prototype/app-pages";

type Props = { params: Promise<{ type: string; id: string }> };

export default async function EditRecordPage({ params }: Props) {
  await connection();
  const { type, id } = await params;
  const data = loadRecordPage(type, "form", decodeURIComponent(id));
  if (!data?.record) notFound();
  return <RecordFormApp objectType={type} config={data.config} record={data.record} navigation={data.navigation} listTitle={data.listTitle} hasDetail={data.hasDetail} workspaceName={data.workspaceName} />;
}
