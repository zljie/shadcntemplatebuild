/**
 * Acceptance check for the full frontend flow, driven only through MCP (STDIO):
 * import_business_model → run_business_sandbox → generate_app_design → export_app, then
 * type-check and build the exported project. node_modules is a copy-on-write clone of this
 * checkout's (macOS APFS `cp -c`, no network) unless `--install` asks for a real `npm install`.
 * The LLM provider is mock (rule-based) unless VERIFY_LLM_PROVIDER names a configured one.
 * Usage: npm run verify:app-export [-- --install]
 */
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

if (process.env.VERIFY_LLM_PROVIDER) { try { process.loadEnvFile(".env.local"); } catch { /* keys may come from the environment */ } }
const work = await mkdtemp(path.join(tmpdir(), "verify-app-"));
const client = new Client({ name: "verify-app-export", version: "0.1.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath, args: ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), path.resolve("src/mcp/server.mts")],
  env: { ...(process.env as Record<string, string>), DATABASE_PATH: path.join(work, "composer.db"), DATABASE_SEED: "off", LLM_PROVIDER: process.env.VERIFY_LLM_PROVIDER ?? "mock" },
}));
async function call(name: string, args: Record<string, unknown>) {
  const response = await client.callTool({ name, arguments: args });
  const value = response.structuredContent as Record<string, unknown>;
  if (response.isError) throw new Error(`${name}: ${JSON.stringify(value)}`);
  return value;
}

const { model } = await call("import_business_model", { yaml: readFileSync("docs/business-model/campus_library.yaml", "utf8"), fileName: "campus_library.yaml" }) as { model: { id: string } };
const sandbox = await call("run_business_sandbox", { id: model.id, count: 3 });
const design = await call("generate_app_design", { id: model.id });
const exported = await call("export_app", { id: model.id }) as { projectDir: string; files: string[]; modules: unknown[] };
await client.close();
console.log(`sandbox ${(sandbox.scenarios as unknown[]).length} scenarios (${sandbox.source}); design ${(design.modules as unknown[]).length} modules (${design.source}); exported ${exported.files.length} files → ${exported.projectDir}`);

const dir = exported.projectDir;
if (process.argv.includes("--install")) execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "inherit" });
else execFileSync("cp", ["-cR", path.resolve("node_modules"), path.join(dir, "node_modules")]);
const run = (bin: string, args: string[]) => execFileSync(path.join(dir, "node_modules/.bin", bin), args, { cwd: dir, stdio: "inherit" });
run("tsc", ["--noEmit"]);
run("next", ["build"]);
console.log(`build ok: ${dir}`);
