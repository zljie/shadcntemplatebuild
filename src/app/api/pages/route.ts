import { generatePages, listPages } from "@/server/ontology-store";
import { issuesResponse, readJson } from "@/core/http";
import { pageKinds, type PageKind } from "@/ontology/model";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ pages: listPages() });
}

/** Body: {objectType, kinds?: PageKind[], overwrite?: boolean}. Generates pages from the ontology. */
export async function POST(request: Request) {
  const parsed = await readJson(request, 10_000);
  if ("error" in parsed) return parsed.error;
  const { objectType, kinds, overwrite } = parsed.body;
  const selected = Array.isArray(kinds) ? kinds.filter((k): k is PageKind => pageKinds.includes(k as PageKind)) : [...pageKinds];
  const result = generatePages(String(objectType ?? ""), selected, { overwrite: overwrite === true });
  return result.ok ? Response.json({ pages: result.value }) : issuesResponse(result.errors, 404);
}
