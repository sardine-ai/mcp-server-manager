/**
 * Bridge command - stdio entry point that clients launch in their project folder.
 * Proxies MCP messages to the gateway and tells it the project folder, so local
 * servers (serena, jbcontext, ...) run there instead of in the daemon's folder.
 */

import type { Command } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import { PROJECT_DIR_HEADER, resolveProjectDir } from "../../services/gateway.service.js";

// ponytail: no re-initialize if the daemon restarts mid-session; the client restarts the server.
export async function runBridge(url: string, projectDir?: string): Promise<void> {
  // stdout carries JSON-RPC; keep stray logs off it
  console.log = console.error;

  const headers = projectDir ? { [PROJECT_DIR_HEADER]: encodeURIComponent(projectDir) } : undefined;
  const upstream = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : {}
  );
  const local = new StdioServerTransport();

  local.onmessage = (message): void => {
    upstream.send(message).catch((error: unknown) => {
      if (!isJSONRPCRequest(message)) return;
      const reason = error instanceof Error ? error.message : String(error);
      void local.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: `mcpsm gateway unreachable at ${url}: ${reason}` },
      });
    });
  };
  upstream.onmessage = (message): void => {
    const version = (message as { result?: { protocolVersion?: unknown } }).result?.protocolVersion;
    if (typeof version === "string") upstream.setProtocolVersion(version);
    void local.send(message);
  };
  upstream.onerror = (error): void => console.error(`mcpsm bridge: ${error.message}`);

  // End the gateway session so it can stop this project's servers
  const shutdown = async (): Promise<void> => {
    await upstream.terminateSession().catch(() => {});
    await upstream.close().catch(() => {});
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  await upstream.start();
  await local.start();
}

export function registerBridgeCommands(program: Command): void {
  program
    .command("bridge <url>")
    .description("Stdio bridge to the gateway for the current project (used in client configs)")
    .option("--cwd <dir>", "Project folder when the client does not start the bridge in it")
    .action(async (url: string, options: { cwd?: string }) => {
      await runBridge(url, resolveProjectDir([options.cwd, process.cwd()]));
    });
}
