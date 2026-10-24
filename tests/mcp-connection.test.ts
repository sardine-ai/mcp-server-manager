import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  JSONRPCMessageSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
  type ListToolsResult,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TestingService } from "../src/services/testing.service.js";
import { getConfigService, resetConfigService } from "../src/services/config.service.js";
import { createMcpConnection, closeMcpConnection } from "../src/services/mcp-connection.js";

describe("SDK connections against local fixtures", () => {
  let directory: string;
  const originalDirectory = process.env.MCP_MANAGER_CONFIG_DIR;
  const cleanup: Array<() => Promise<void>> = [];
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-protocol-"));
    process.env.MCP_MANAGER_CONFIG_DIR = directory;
    resetConfigService();
  });
  afterEach(async () => {
    for (const close of cleanup.splice(0)) await close();
    resetConfigService();
    if (originalDirectory === undefined) delete process.env.MCP_MANAGER_CONFIG_DIR;
    else process.env.MCP_MANAGER_CONFIG_DIR = originalDirectory;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function startMcpFixture(route = "json") {
    const requests: Array<{ method: string; authorization?: string; session?: string }> = [];
    const mcp = new Server({ name: "fixture", version: "1" }, { capabilities: { tools: {} } });
    let transport: StreamableHTTPServerTransport | SSEServerTransport | undefined;

    mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      if (route === "bad") throw new McpError(ErrorCode.InternalError, "fixture error");
      const result: ListToolsResult = {
        tools: [{ name: "echo", inputSchema: { type: "object" } }],
      };
      if (route === "empty") result.tools = [];
      if (route === "page") result.nextCursor = "next";
      return result;
    });

    async function handleRequest(request: IncomingMessage, response: ServerResponse) {
      if (route === "unauthorized") {
        response
          .writeHead(401, {
            "WWW-Authenticate":
              'Bearer scope="read", resource_metadata="http://localhost/metadata"',
          })
          .end();
        return;
      }
      if (route === "stall") return;
      if (route === "sse" && request.method === "GET") {
        transport = new SSEServerTransport("/message", response);
        await mcp.connect(transport);
        return;
      }
      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => "fixture-session",
          enableJsonResponse: route !== "events",
        });
        await mcp.connect(transport);
      }

      let message;
      if (request.method === "POST") {
        let body = "";
        for await (const chunk of request) body += chunk;
        message = JSONRPCMessageSchema.parse(JSON.parse(body));
        if ("method" in message) {
          requests.push({
            method: message.method,
            authorization: request.headers.authorization,
            session: String(request.headers["mcp-session-id"] || ""),
          });
        }
      }
      if (transport instanceof SSEServerTransport) {
        await transport.handlePostMessage(request, response, message);
        return;
      }
      await transport.handleRequest(request, response, message);
    }

    const server = createServer((request, response) => {
      handleRequest(request, response).catch((error) => response.destroy(error));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    cleanup.push(async () => {
      await mcp.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    return { url: "http://127.0.0.1:" + address.port, requests };
  }

  it.each(["json", "events", "sse", "empty", "page"])("discovers tools over %s", async (route) => {
    const local = await startMcpFixture(route);
    const result = await new TestingService().testRemoteServer({
      id: "fixture",
      name: "Fixture",
      type: route === "sse" ? "sse" : "http",
      url: local.url + "/" + route,
      bearerToken: "fixture-token",
    });
    expect(result).toMatchObject({ success: true, toolCount: route === "empty" ? 0 : 1 });
    expect(local.requests.filter((request) => request.method === "tools/list")).toHaveLength(1);
    expect(
      local.requests.every((request) => request.authorization === "Bearer fixture-token")
    ).toBe(true);
    if (route !== "sse")
      expect(local.requests.find((request) => request.method === "tools/list")?.session).toBe(
        "fixture-session"
      );
    expect(getConfigService().getToolFilters()["remote:fixture"].allTools).toHaveLength(
      route === "empty" ? 0 : 1
    );
  });

  it("preserves 401 metadata and reports protocol errors", async () => {
    const unauthorized = await startMcpFixture("unauthorized");
    const bad = await startMcpFixture("bad");
    const testing = new TestingService();
    const server = {
      id: "fixture",
      name: "Fixture",
      type: "http" as const,
      url: unauthorized.url + "/unauthorized",
    };
    await expect(testing.testRemoteServer(server, true)).resolves.toMatchObject({
      success: false,
      requiresAuth: true,
      authRequirements: { scope: "read" },
    });
    await expect(
      testing.testRemoteServer({ ...server, url: bad.url + "/bad" })
    ).resolves.toMatchObject({ success: false, error: expect.stringContaining("fixture error") });
  });

  it("terminates a stalled HTTP response within the test deadline", async () => {
    const local = await startMcpFixture("stall");
    const started = Date.now();
    const result = await new TestingService().testRemoteServer({
      id: "stall",
      name: "Stall",
      type: "http",
      url: local.url + "/stall",
    });
    expect(result).toMatchObject({ success: false, error: "Timeout" });
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it.each(["gateway", "test"] as const)(
    "preserves arguments and shell commands for %s",
    async (purpose) => {
      const fixturePath = path.resolve("tests/fixtures/mcp-server.mjs");
      const connection = createMcpConnection(
        {
          id: "stdio",
          name: "Fixture",
          command: process.execPath,
          args: [fixturePath, "value with spaces; $HOME"],
        },
        purpose
      );
      try {
        await connection.client.connect(connection.transport);
        const result = await connection.client.listTools();
        expect(result.tools[0].description).toBe("value with spaces; $HOME");
      } finally {
        await closeMcpConnection(connection);
      }
      if ("pid" in connection.transport) expect(connection.transport.pid).toBeNull();
    }
  );

  it("reports subprocess exit without waiting for timeout", async () => {
    const result = await new TestingService().testLocalServer({
      id: "exit",
      name: "Exit",
      command: process.execPath,
      args: [path.resolve("tests/fixtures/mcp-server.mjs"), "--exit"],
    });
    expect(result.success).toBe(false);
    expect(result.error).not.toBe("Timeout");
  });
});
