import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getPage, hydratedListDetailDocument } from "@/server/ontology-store";
import { appNavigation } from "@/server/navigation";
import { pageId } from "@/ontology/model";
import { ListDetailApp, type LiveSource } from "@/prototype/app-pages";
import { opcConfig, queryCapability } from "@/server/opc-platform";
import { rowsFromResult } from "@/runtime/opc";
import type { PageDocument } from "@/core/schema";

/**
 * Page DSL 0.2.0: a list bound to a published capability reads its rows from the BFF when opc-platform is
 * configured; record forms give way to the page's business commands. Unreachable → SQLite rows with a note.
 */
async function withLiveRows(document: PageDocument): Promise<{document: PageDocument; live?: LiveSource}> {
  const source = document.listDetail?.dataSource;
  if (!document.listDetail || typeof source !== "object" || !opcConfig().urls.bff) return {document};
  const read = await queryCapability(source.capabilityRef, source.input);
  if (!read.ok || read.result.status !== "SUCCEEDED") return {document, live: undefined};
  const {form: _form, ...listDetail} = document.listDetail;
  void _form;
  return {document: {...document, listDetail: {...listDetail, rows: rowsFromResult(read.result.data, source, listDetail.fields).slice(0, 200)}}, live: {label: `BFF · ${source.capabilityRef}`}};
}

type Props = { params: Promise<{ type: string }> };

export default async function ListDetailPage({ params }: Props) {
  await connection();
  const { type } = await params;
  const document = getPage(pageId(type, "list-detail")) ? hydratedListDetailDocument(type) : null;
  if (!document) notFound();
  const { navigation } = appNavigation(type);
  const bound = await withLiveRows(document);
  return <ListDetailApp document={bound.document} objectType={type} navigation={navigation} live={bound.live} />;
}
