// Minimal stdio MCP server whose only tool reports the folder and pid it runs in.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";

const server = new McpServer({ name: "cwd-fixture", version: "1.0.0" });
server.registerTool("cwd", { description: "Report the working directory" }, async () => ({
  content: [{ type: "text", text: JSON.stringify({ cwd: process.cwd(), pid: process.pid }) }],
}));
await server.connect(new StdioServerTransport());
