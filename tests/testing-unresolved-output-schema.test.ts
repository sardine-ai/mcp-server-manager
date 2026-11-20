import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TestingService } from "../src/services/testing.service.js";

const configService = {
  getServerToolFilter: vi.fn(() => undefined),
  setServerToolFilter: vi.fn(),
  updateRemoteServer: vi.fn(),
  getToolFilters: vi.fn(() => ({})),
  getLocalServers: vi.fn(() => []),
  getRemoteServers: vi.fn(() => []),
};

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: () => configService,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: () => ({
    getValidToken: vi.fn(),
    parseWWWAuthenticate: vi.fn(),
    startOAuthFlow: vi.fn(),
    waitForAuth: vi.fn(),
    stopCallbackServer: vi.fn(),
    hasValidToken: vi.fn(),
    getPendingAuthState: vi.fn(),
  }),
}));

vi.mock("../src/services/environment.service.js", () => ({
  getEnvironmentService: () => ({
    getShellCommand: vi.fn(),
    shouldUseZsh: vi.fn(() => false),
  }),
}));

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate test port"));
        return;
      }
      resolve(address.port);
    });
  });
}

describe("SSE tool discovery with unresolved output schemas", () => {
  const servers: HttpServer[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          })
      )
    );
  });

  it("reports the tools when an SSE server advertises an unresolved output schema $ref", async () => {
    const sessions = new Map<string, SSEServerTransport>();
    const upstream = createServer(async (req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/sse") {
        const transport = new SSEServerTransport("/messages", res);
        sessions.set(transport.sessionId, transport);
        const server = new Server(
          { name: "sse-fixture", version: "1.0.0" },
          { capabilities: { tools: {} } }
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [
            {
              name: "list_projects",
              description: "List projects",
              inputSchema: { type: "object" as const, properties: {} },
              outputSchema: {
                type: "object" as const,
                properties: { screen: { $ref: "#/$defs/ScreenInstance" } },
              },
            },
          ],
        }));
        await server.connect(transport);
        return;
      }

      if (req.method === "POST" && url.pathname === "/messages") {
        const transport = sessions.get(url.searchParams.get("sessionId") || "");
        if (!transport) {
          res.writeHead(404);
          res.end("missing session");
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });
    servers.push(upstream);
    const port = await listen(upstream);

    const result = await new TestingService().testRemoteServer({
      id: "sse-schema",
      name: "sse-schema",
      type: "sse",
      url: `http://127.0.0.1:${port}/sse`,
    });

    expect(result).toEqual({ success: true, toolCount: 1 });
    expect(configService.setServerToolFilter).toHaveBeenCalledWith(
      "remote:sse-schema",
      expect.objectContaining({ allTools: ["list_projects"] })
    );
  });
});
