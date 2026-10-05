// Writes a static shadcn registry to public/r (for hosting on any static server / CDN).
// Usage: REGISTRY_BASE_URL=https://your-host npx tsx scripts/build-registry.mts [outDir]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  registryIndex,
  runtimeItem,
  templateItem,
  RUNTIME_ITEM,
} from "../src/core/shadcn-registry";
import { listTemplates } from "../src/core/templates";

const base = (process.env.REGISTRY_BASE_URL ?? "http://127.0.0.1:3100").replace(
  /\/$/,
  "",
);
const out = path.resolve(process.argv[2] ?? "public/r");
await mkdir(out, { recursive: true });
const write = async (name: string, value: unknown) => {
  await writeFile(
    path.join(out, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
  console.log("wrote", `${name}.json`);
};
await write("registry", await registryIndex(base));
await write(RUNTIME_ITEM, await runtimeItem());
for (const t of await listTemplates())
  await write(`template-${t.id}`, await templateItem(t.id, base));
