// Minimal stdio MCP server whose `cwd` tool reports the folder and pid it runs in. Like
// serena, its tool set depends on the folder: `project_only` in folders with a
// .fixture-project marker, `shared_only` elsewhere.
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";

const text = (value) => ({ content: [{ type: "text", text: value }] });
const server = new McpServer({ name: "cwd-fixture", version: "1.0.0" });
server.registerTool("cwd", { description: "Report the working directory" }, async () =>
  text(JSON.stringify({ cwd: process.cwd(), pid: process.pid }))
);
if (fs.existsSync(".fixture-project")) {
  server.registerTool("project_only", { description: "Only in a project" }, async () =>
    text("project")
  );
} else {
  server.registerTool("shared_only", { description: "Only outside a project" }, async () =>
    text("shared")
  );
}
await server.connect(new StdioServerTransport());
