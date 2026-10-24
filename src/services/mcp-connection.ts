import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { LocalServer, RemoteServer } from "../types/index.js";
import { getEnvironmentService } from "./environment.service.js";
import { getAuthService } from "./auth.service.js";
import { createTransportAuthProvider } from "./oauth-transport.provider.js";
import { VERSION } from "../shared/version.js";

export function createMcpConnection(
  server: LocalServer | RemoteServer,
  purpose: "gateway" | "test",
  options: { headers?: Record<string, string>; fetch?: FetchLike } = {}
) {
  let transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
  if ("command" in server) {
    const environment = getEnvironmentService();
    const wrap =
      purpose === "gateway" ||
      (environment.shouldUseZsh() &&
        (server.command.includes("/") || server.command === "sh" || server.command === "bash"));
    const script =
      purpose === "gateway"
        ? 'export PATH="' + path.dirname(process.execPath) + ':$PATH"; exec "$@"'
        : 'exec "$@"';
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries({ ...process.env, ...server.env })) {
      if (value !== undefined) env[key] = value;
    }
    transport = new StdioClientTransport({
      command: wrap ? environment.getShellCommand() : server.command,
      args: wrap
        ? [
            ...(purpose === "gateway" ? ["-l"] : []),
            "-c",
            script,
            "mcpsm",
            server.command,
            ...(server.args || []),
          ]
        : server.args,
      env,
      stderr: purpose === "test" ? "ignore" : "inherit",
    });
  } else {
    const headers = { ...server.headers, ...options.headers };
    if (server.bearerToken) headers.Authorization = "Bearer " + server.bearerToken;
    const authProvider =
      purpose === "gateway" && !server.bearerToken && server.oauth?.enabled
        ? createTransportAuthProvider(server, getAuthService())
        : undefined;
    const transportOptions = {
      requestInit: Object.keys(headers).length ? { headers } : undefined,
      authProvider,
      fetch: options.fetch,
    };
    transport =
      server.type === "sse"
        ? new SSEClientTransport(new URL(server.url), transportOptions)
        : new StreamableHTTPClientTransport(new URL(server.url), transportOptions);
  }
  const client = new Client(
    {
      name: purpose === "gateway" ? "mcpsm-gateway" : "mcp-tester",
      version: purpose === "gateway" ? VERSION : "1.0.0",
    },
    { capabilities: {} }
  );
  return { client, transport };
}

export async function closeMcpConnection(connection: ReturnType<typeof createMcpConnection>) {
  try {
    await connection.client.close();
  } finally {
    await connection.transport.close();
  }
}
