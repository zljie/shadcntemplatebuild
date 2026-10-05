import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { fileURLToPath } from "node:url";
import { createPageServer } from "./tools";

// STDIO entry: `npm run mcp`. Same tools as the HTTP endpoint (/api/mcp) plus export_project.
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
if (process.versions.node.split(".")[0] !== "22") throw new Error("Node 22 required");
serveStdio(() => createPageServer({ local: true, registryBaseUrl: process.env.REGISTRY_BASE_URL?.replace(/\/$/, "") }));
