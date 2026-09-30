import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { componentCapabilities, pageProtocol } from "../core/page-protocol";
import { validateDocument } from "../core/validation";
import { exportProject } from "../core/export-project";
import type { PageDocument } from "../core/schema";

process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
if (process.versions.node.split(".")[0] !== "22") throw new Error("Node 22 required");
const result = (value: Record<string, unknown>, isError = false) => ({content:[{type:"text" as const,text:JSON.stringify(value)}],structuredContent:value,isError});
serveStdio(() => {
  const server = new McpServer({name:"shadcnplane-pages",version:"0.1.0"});
  const readOnly = {readOnlyHint:true,destructiveHint:false,openWorldHint:false};
  server.registerTool("list_components", {description:"Query the project's registered DSL components, props schemas, source, slots and limitations. These are the only supported components.",inputSchema:z.object({}).strict(),annotations:readOnly}, async () => result({components:componentCapabilities()}));
  server.registerTool("get_page_protocol", {description:"Read page DSL schema, shared list/detail template, example dataset and page rules before generating a business page.",inputSchema:z.object({}).strict(),annotations:readOnly}, async () => result(pageProtocol()));
  server.registerTool("validate_page", {description:"Validate an AI-generated page DSL against the existing project validator, including component, props, combination and business field rules. Returns valid and path/message errors.",inputSchema:z.object({document:z.unknown()}).strict(),annotations:readOnly}, async ({document}) => {
    const errors=validateDocument(document);return result({valid:errors.length===0,errors},errors.length>0);
  });
  server.registerTool("export_project", {description:"Validate DSL and use the existing exporter to create an independent runnable Next.js project in a NEW directory outside the repository. Returns projectDir and files; never overwrites an existing project.",inputSchema:z.object({document:z.unknown()}).strict(),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}}, async ({document}) => {
    const errors=validateDocument(document);if(errors.length)return result({valid:false,errors},true);
    const files=await exportProject(document as PageDocument);
    const projectDir=await mkdtemp(path.join(tmpdir(),"shadcnplane-page-"));
    for(const [name,content] of Object.entries(files)){const destination=path.join(projectDir,name);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,content,{flag:"wx"});}
    return result({valid:true,projectDir,files:Object.keys(files)});
  });
  return server;
});
