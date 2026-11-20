import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  getGatewayStatus,
  refreshGatewayTools,
  resetGatewayStateForTests,
  setGatewayStateForTests,
  startGateway,
  stopGateway,
} from "../src/services/gateway.service.js";

const unresolvedOutputSchema = {
  type: "object" as const,
  properties: {
    screen: { $ref: "#/$defs/ScreenInstance" },
  },
};

const validOutputSchema = {
  type: "object" as const,
  properties: {
    query: { type: "string" as const },
  },
};

const configService = {
  reload: vi.fn(),
  getPort: vi.fn(() => 0),
  getSelectionState: vi.fn(() => ({ local: [], remote: [] })),
  getLocalServers: vi.fn(() => []),
  getRemoteServers: vi.fn(() => []),
  getToolFilters: vi.fn(() => ({})),
};

const authService = {
  reload: vi.fn(),
  stopProactiveRefresh: vi.fn(),
  startProactiveRefresh: vi.fn(),
};

const profileService = {
  reload: vi.fn(),
  list: vi.fn(() => [{ id: "default" }]),
  getProfile: vi.fn(() => ({ id: "default", servers: [], remoteServers: [] })),
};

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: () => configService,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: () => authService,
}));

vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: () => profileService,
}));

function createUpstreamServer(): Server {
  const server = new Server(
    { name: "stitch-fixture", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search",
        description: "Search",
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: validOutputSchema,
      },
      {
        name: "list_projects",
        description: "List projects",
        inputSchema: { type: "object" as const, properties: {} },
        outputSchema: unresolvedOutputSchema,
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: "text" as const, text: `called ${request.params.name}` }],
  }));
  return server;
}

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

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate test port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

describe("Gateway unresolved output schemas", () => {
  const closers: Array<() => Promise<void>> = [];

  beforeEach(() => {
    resetGatewayStateForTests();
    vi.clearAllMocks();
    configService.getLocalServers.mockReturnValue([]);
    configService.getRemoteServers.mockReturnValue([]);
    configService.getToolFilters.mockReturnValue({});
    profileService.list.mockReturnValue([{ id: "default" }]);
    profileService.getProfile.mockReturnValue({
      id: "default",
      servers: [],
      remoteServers: [],
    });
  });

  afterEach(async () => {
    await stopGateway();
    resetGatewayStateForTests();
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("keeps a remote server connected when a tool output schema has an unresolved $ref", async () => {
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const upstream = createServer(async (req, res) => {
      const sessionId = req.headers["mcp-session-id"];
      const existing = typeof sessionId === "string" ? sessions.get(sessionId) : undefined;
      if (existing) {
        await existing.handleRequest(req, res);
        return;
      }

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
        },
      });
      await createUpstreamServer().connect(transport);
      await transport.handleRequest(req, res);
    });
    const upstreamPort = await listen(upstream);
    closers.push(
      () =>
        new Promise((resolve) => {
          upstream.closeAllConnections();
          upstream.close(() => resolve());
        })
    );

    const gatewayPort = await getFreePort();
    configService.getPort.mockReturnValue(gatewayPort);
    configService.getRemoteServers.mockReturnValue([
      {
        id: "stitch",
        name: "stitch",
        type: "http" as const,
        url: `http://127.0.0.1:${upstreamPort}/mcp`,
      },
    ]);

    await expect(startGateway(["remote:stitch"])).resolves.toEqual({ success: true });
    expect(getGatewayStatus()).toMatchObject({ serverCount: 1, toolCount: 2 });

    const client = new Client({ name: "gateway-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${gatewayPort}/mcp`)
    );
    await client.connect(transport);
    closers.push(async () => {
      await client.close();
    });

    const listed = await client.listTools();
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(["stitch__list_projects", "stitch__search"]);
    expect(byName.get("stitch__search")?.outputSchema).toMatchObject({
      properties: { query: { type: "string" } },
    });
    expect(byName.get("stitch__list_projects")?.outputSchema).toBeUndefined();

    const called = await client.callTool({
      name: "stitch__list_projects",
      arguments: {},
    });
    expect(called.content).toEqual([{ type: "text", text: "called list_projects" }]);
  });

  it("refreshes tools when a connected server returns an unresolved output schema", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const upstream = createUpstreamServer();
    await upstream.connect(serverTransport);
    const client = new Client({ name: "mcpsm-gateway", version: "1.0.0" });
    await client.connect(clientTransport);
    closers.push(async () => {
      await client.close();
      await upstream.close();
    });

    setGatewayStateForTests({
      running: true,
      connectedServers: new Map([
        [
          "remote:stitch",
          {
            id: "remote:stitch",
            name: "stitch",
            type: "remote",
            client,
            transport: clientTransport,
            tools: [],
          },
        ],
      ]),
    });

    await expect(refreshGatewayTools("test")).resolves.toEqual({ success: true });
    expect(getGatewayStatus()).toMatchObject({ serverCount: 1, toolCount: 2 });
  });
});
