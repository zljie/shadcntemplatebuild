import { NextResponse } from "next/server";
import { registryEntry } from "@/core/shadcn-registry";

export const runtime = "nodejs";

// shadcn-compatible registry: GET /r/registry.json, /r/shadcnplane-runtime.json, /r/template-<id>.json
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const base = process.env.REGISTRY_BASE_URL ?? new URL(request.url).origin;
  const entry = await registryEntry((await params).name, base);
  if (!entry)
    return NextResponse.json(
      { error: "registry item not found" },
      { status: 404 },
    );
  return NextResponse.json(entry, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
