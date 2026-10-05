import { catalog, generatePages, saveObjectType } from "@/server/ontology-store";
import { issuesResponse, readJson } from "@/core/http";

export const runtime = "nodejs";

export async function GET() {
  return Response.json({ objectTypes: catalog() });
}

/** Upsert one object type (`{type}`) or several in order (`{types:[...]}`); `generatePages` builds list-detail, detail and form pages. */
export async function POST(request: Request) {
  const parsed = await readJson(request);
  if ("error" in parsed) return parsed.error;
  const { body } = parsed;
  const inputs = Array.isArray(body.types) ? body.types : [body.type];
  const saved = [];
  for (const [index, input] of inputs.entries()) {
    const result = saveObjectType(input);
    if (!result.ok) return issuesResponse(result.errors.map((e) => ({ ...e, path: inputs.length > 1 ? `types.${index}.${e.path}` : e.path })));
    saved.push(result.value);
  }
  if (body.generatePages !== false)
    for (const type of saved) {
      const pages = generatePages(type.apiName);
      if (!pages.ok) return issuesResponse(pages.errors);
    }
  return Response.json({ objectTypes: saved });
}
