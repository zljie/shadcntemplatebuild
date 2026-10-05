import { notFound } from "next/navigation";
import { connection } from "next/server";
import { loadRecordPage } from "@/prototype/load";
import { RecordFormApp } from "@/prototype/app-pages";

type Props = { params: Promise<{ type: string }> };

export default async function NewRecordPage({ params }: Props) {
  await connection();
  const { type } = await params;
  const data = loadRecordPage(type, "form");
  if (!data) notFound();
  return <RecordFormApp objectType={type} config={data.config} navigation={data.navigation} listTitle={data.listTitle} hasDetail={data.hasDetail} workspaceName={data.workspaceName} />;
}
