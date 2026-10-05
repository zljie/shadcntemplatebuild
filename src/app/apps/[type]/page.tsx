import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getPage, hydratedListDetailDocument } from "@/server/ontology-store";
import { appNavigation } from "@/server/navigation";
import { pageId } from "@/ontology/model";
import { ListDetailApp } from "@/prototype/app-pages";

type Props = { params: Promise<{ type: string }> };

export default async function ListDetailPage({ params }: Props) {
  await connection();
  const { type } = await params;
  const document = getPage(pageId(type, "list-detail")) ? hydratedListDetailDocument(type) : null;
  if (!document) notFound();
  const { navigation } = appNavigation(type);
  return <ListDetailApp document={document} objectType={type} navigation={navigation} />;
}
