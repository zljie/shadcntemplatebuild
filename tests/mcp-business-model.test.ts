import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** Full frontend flow through MCP only: YAML → business model → sandbox → app design → page edit → export. */
let dir = "", projectDir = "";
const client = new Client({name: "business-model-flow", version: "0.1.0"});
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mcp-bm-"));
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ["--import", path.resolve("node_modules/tsx/dist/loader.mjs"), path.resolve("src/mcp/server.mts")], cwd: "/tmp",
    env: {...process.env as Record<string, string>, DATABASE_PATH: path.join(dir, "mcp.db"), DATABASE_SEED: "off", LLM_PROVIDER: "mock"},
  }));
});
afterAll(async () => {
  await client.close();
  await rm(dir, {recursive: true, force: true});
  if (projectDir) await rm(projectDir, {recursive: true, force: true});
});
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const response = await client.callTool({name, arguments: args});
  return {...response.structuredContent as Record<string, unknown>, isError: response.isError} as Record<string, unknown> & {isError?: boolean};
};

it("drives the whole flow and exports a multi-page frontend project", async () => {
  const imported = await call("import_business_model", {yaml: readFileSync("docs/business-model/campus_library.yaml", "utf8"), fileName: "campus_library.yaml"});
  const model = imported.model as {id: string; counts: Record<string, number>; errors: number};
  expect(model.counts).toMatchObject({entity: 15, relationship: 28, action: 60, rule: 19, metric: 12});
  expect(model.errors).toBe(0);

  const entities = await call("get_business_model", {id: model.id, view: "entities"});
  const loan = (entities.entities as {id: string; fields: {id: string; enum?: {values: string[]}}[]}[]).find(e => e.id === "loan")!;
  expect(loan.fields.find(f => f.id === "status")?.enum?.values).toEqual(["OPEN", "RETURNED", "LOST"]);
  expect((await call("get_business_model", {id: model.id, view: "nope"})).isError).toBe(true);

  const sandbox = await call("run_business_sandbox", {id: model.id, count: 3});
  const scenarios = sandbox.scenarios as {id: string; issues: {severity: string}[]}[];
  expect(sandbox.source).toBe("rule-based");
  expect(scenarios).toHaveLength(3);
  expect(scenarios.flatMap(s => s.issues).filter(i => i.severity === "error")).toEqual([]);
  const confirmed = await call("update_business_model", {id: model.id, patches: [{kind: "scenario", id: scenarios[0].id, status: "confirmed"}]});
  expect(confirmed.isError).toBeFalsy();

  const design = await call("generate_app_design", {id: model.id});
  const modules = design.modules as {entity: string; objectType: string; pages: number; listPageId: string}[];
  expect(modules).toHaveLength(14);
  expect(modules.every(m => m.pages === 3)).toBe(true);

  const page = await call("get_app_page", {objectType: "campus-library-loan"});
  const document = page.document as {name: string};
  const saved = await call("save_app_page", {objectType: "campus-library-loan", document: {...document, name: "借阅台账"}});
  expect(saved.saved).toBe(true);
  expect((await call("save_app_page", {objectType: "campus-library-loan", document: {nope: true}})).isError).toBe(true);

  const exported = await call("export_app", {id: model.id});
  projectDir = exported.projectDir as string;
  const files = exported.files as string[];
  for (const file of ["package.json", "contract.json", "app-design.json", "src/app-runtime/repository.ts", "src/app-runtime/modules.ts", "src/app/loan/page.tsx", "src/app/loan/[id]/page.tsx", "src/app/loan/new/page.tsx", "src/app/loan/[id]/edit/page.tsx", "src/app-data/loan.json", "dsl/loan.dsl.json"])
    expect(files).toContain(file);
  expect(files.filter(f => /^src\/app\/[^/]+\/page\.tsx$/.test(f))).toHaveLength(14);
  const listPage = await readFile(path.join(projectDir, "src/app/loan/page.tsx"), "utf8");
  expect(listPage).toContain('useAppModule("loan"');
  expect(listPage).toContain("借阅台账");
  const trace = JSON.parse(await readFile(path.join(projectDir, "app-design.json"), "utf8"));
  expect(trace.model).toMatchObject({name: "campus_library", sourceVersion: "0.1.2"});
  expect(trace.scenarios.find((s: {id: string}) => s.id === scenarios[0].id).status).toBe("confirmed");
  const contract = JSON.parse(await readFile(path.join(projectDir, "contract.json"), "utf8"));
  expect(contract.modules.find((m: {key: string}) => m.key === "loan").actions.map((a: {id: string}) => a.id)).toContain("library_loan_borrow");
  expect(JSON.parse(await readFile(path.join(projectDir, "src/app-data/loan.json"), "utf8"))[0].copy_id).toBe("BOOK-COPY-001");
}, 120_000);
