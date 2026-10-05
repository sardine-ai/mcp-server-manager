import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import net from "net";
import type { LocalServer, RemoteServer } from "../src/types/index.js";

const sdkMocks = vi.hoisted(() => {
  const clientInstances: any[] = [];
  const stdioTransports: any[] = [];
  const sseTransports: any[] = [];
  const httpTransports: any[] = [];
  const serverInstances: any[] = [];
  const serverTransports: any[] = [];
  const listToolsResults: any[] = [];

  const Client = vi.fn(function () {
    const instance = {
      connect: vi.fn(),
      listTools: vi.fn().mockResolvedValue(listToolsResults.shift() ?? { tools: [] }),
      callTool: vi.fn(),
    };
    clientInstances.push(instance);
    return instance;
  });

  const StdioClientTransport = vi.fn(function (options: unknown) {
    const instance = {
      options,
      close: vi.fn(),
    };
    stdioTransports.push(instance);
    return instance;
  });

  const SSEClientTransport = vi.fn(function (url: URL, options: unknown) {
    const instance = {
      url,
      options,
      close: vi.fn(),
    };
    sseTransports.push(instance);
    return instance;
  });

  const StreamableHTTPClientTransport = vi.fn(function (url: URL, options: unknown) {
    const instance = {
      url,
      options,
      close: vi.fn(),
    };
    httpTransports.push(instance);
    return instance;
  });

  const StreamableHTTPServerTransport = vi.fn(function (options: any) {
    const instance = {
      options,
      onclose: undefined as (() => void) | undefined,
      handleRequest: vi.fn((_req: unknown, res: any) => {
        options.onsessioninitialized?.("session-1");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }),
      close: vi.fn(),
    };
    serverTransports.push(instance);
    return instance;
  });

  const Server = vi.fn(function () {
    const handlers = new Map<unknown, unknown>();
    const instance = {
      handlers,
      setRequestHandler: vi.fn((schema: unknown, handler: unknown) => {
        handlers.set(schema, handler);
      }),
      connect: vi.fn(),
      close: vi.fn(),
      sendToolListChanged: vi.fn(),
    };
    serverInstances.push(instance);
    return instance;
  });

  return {
    Client,
    StdioClientTransport,
    SSEClientTransport,
    StreamableHTTPClientTransport,
    StreamableHTTPServerTransport,
    Server,
    clientInstances,
    stdioTransports,
    sseTransports,
    httpTransports,
    serverInstances,
    serverTransports,
    listToolsResults,
  };
});

const serviceMocks = vi.hoisted(() => ({
  configService: {
    reload: vi.fn(),
    getPort: vi.fn(),
    getSelectionState: vi.fn(),
    getLocalServers: vi.fn(),
    getRemoteServers: vi.fn(),
    getToolFilters: vi.fn(),
  },
  authService: {
    reload: vi.fn(),
    startProactiveRefresh: vi.fn(),
    stopProactiveRefresh: vi.fn(),
  },
  envService: {
    getShellCommand: vi.fn(),
  },
  profileService: {
    reload: vi.fn(),
    list: vi.fn(),
    getProfile: vi.fn(),
  },
}));

const oauthProviderMocks = vi.hoisted(() => ({
  createTransportAuthProvider: vi.fn(() => ({ provider: "oauth" })),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdkMocks.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: sdkMocks.StdioClientTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: sdkMocks.SSEClientTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: sdkMocks.StreamableHTTPClientTransport,
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: sdkMocks.StreamableHTTPServerTransport,
}));

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => ({
  Server: sdkMocks.Server,
}));

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof serviceMocks.configService => serviceMocks.configService,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: (): typeof serviceMocks.authService => serviceMocks.authService,
}));

vi.mock("../src/services/environment.service.js", () => ({
  getEnvironmentService: (): typeof serviceMocks.envService => serviceMocks.envService,
}));

vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: (): typeof serviceMocks.profileService => serviceMocks.profileService,
}));

vi.mock("../src/services/oauth-transport.provider.js", () => ({
  createTransportAuthProvider: oauthProviderMocks.createTransportAuthProvider,
}));

import {
  getGatewayStatus,
  refreshGatewayTools,
  resetGatewayStateForTests,
  setGatewayStateForTests,
  startGateway,
  stopGateway,
} from "../src/services/gateway.service.js";

function localServer(overrides: Partial<LocalServer> = {}): LocalServer {
  return {
    id: "local1",
    name: "Local One",
    command: "node",
    args: ["server.js"],
    env: { API_KEY: "secret" },
    ...overrides,
  };
}

function remoteServer(overrides: Partial<RemoteServer> = {}): RemoteServer {
  return {
    id: "remote1",
    name: "Remote One",
    type: "http",
    url: "https://remote.test/mcp",
    ...overrides,
  };
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

async function setupGatewayMocks(): Promise<{
  port: number;
  local: LocalServer;
  remoteHttp: RemoteServer;
  remoteSse: RemoteServer;
}> {
  const port = await getFreePort();
  const local = localServer();
  const remoteHttp = remoteServer({
    oauth: { enabled: true },
    headers: { "X-Remote": "value" },
  });
  const remoteSse = remoteServer({
    id: "remote2",
    name: "Remote Two",
    type: "sse",
    url: "https://remote.test/sse",
    bearerToken: "static",
  });

  serviceMocks.configService.getPort.mockReturnValue(port);
  serviceMocks.configService.getSelectionState.mockReturnValue({
    local: [local.id],
    remote: [`remote:${remoteHttp.id}`, `remote:${remoteSse.id}`],
  });
  serviceMocks.configService.getLocalServers.mockReturnValue([local]);
  serviceMocks.configService.getRemoteServers.mockReturnValue([remoteHttp, remoteSse]);
  serviceMocks.configService.getToolFilters.mockReturnValue({
    local1: { disabledTools: ["hiddenLocal"] },
    "remote:remote1": { disabledTools: ["hiddenRemote"] },
  });
  serviceMocks.envService.getShellCommand.mockReturnValue("/bin/zsh");
  serviceMocks.profileService.list.mockReturnValue([{ id: "default" }, { id: "dev" }]);
  serviceMocks.profileService.getProfile.mockImplementation((profileId: string) => {
    if (profileId === "default") {
      return { id: "default", servers: [], remoteServers: [] };
    }
    if (profileId === "dev") {
      return { id: "dev", servers: ["local1"], remoteServers: ["remote2"] };
    }
    return null;
  });

  sdkMocks.listToolsResults.push(
    {
      tools: [
        { name: "visibleLocal", description: "Visible local" },
        { name: "hiddenLocal", description: "Hidden local" },
      ],
    },
    {
      tools: [
        { name: "visibleRemote", description: "Visible remote" },
        { name: "hiddenRemote", description: "Hidden remote" },
      ],
    },
    {
      tools: [{ name: "sseTool", description: "SSE tool" }],
    }
  );

  return { port, local, remoteHttp, remoteSse };
}

describe("GatewayService unit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGatewayStateForTests();
    sdkMocks.clientInstances.length = 0;
    sdkMocks.stdioTransports.length = 0;
    sdkMocks.sseTransports.length = 0;
    sdkMocks.httpTransports.length = 0;
    sdkMocks.serverInstances.length = 0;
    sdkMocks.serverTransports.length = 0;
    sdkMocks.listToolsResults.length = 0;
    serviceMocks.configService.reload.mockImplementation(() => undefined);
    serviceMocks.authService.reload.mockImplementation(() => undefined);
    serviceMocks.authService.stopProactiveRefresh.mockImplementation(() => undefined);
    serviceMocks.authService.startProactiveRefresh.mockImplementation(() => undefined);
    serviceMocks.profileService.reload.mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await stopGateway();
    resetGatewayStateForTests();
  });

  it("starts on loopback, connects selected servers, serves health and MCP requests, then stops", async () => {
    const { port, local, remoteHttp, remoteSse } = await setupGatewayMocks();

    await expect(
      startGateway([local.id, `remote:${remoteHttp.id}`, `remote:${remoteSse.id}`])
    ).resolves.toEqual({ success: true });

    expect(getGatewayStatus()).toMatchObject({
      running: true,
      port,
      serverCount: 3,
      toolCount: 3,
    });
    expect(sdkMocks.StdioClientTransport).toHaveBeenCalledWith({
      command: "/bin/zsh",
      args: ["-l", "-c", expect.stringContaining("node server.js")],
      env: expect.objectContaining({ API_KEY: "secret" }),
    });
    expect(sdkMocks.StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL("https://remote.test/mcp"),
      expect.objectContaining({
        authProvider: { provider: "oauth" },
        requestInit: { headers: { "X-Remote": "value" } },
      })
    );
    expect(sdkMocks.SSEClientTransport).toHaveBeenCalledWith(
      new URL("https://remote.test/sse"),
      expect.objectContaining({
        requestInit: { headers: { Authorization: "Bearer static" } },
      })
    );
    expect(serviceMocks.authService.startProactiveRefresh).toHaveBeenCalledWith(
      [remoteHttp],
      expect.any(Function)
    );

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    await expect(health.json()).resolves.toEqual({
      status: "ok",
      servers: 3,
      tools: 3,
      profiles: {
        default: { tools: 3, servers: 3 },
        dev: { tools: 2, servers: 2 },
      },
    });

    const options = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "OPTIONS" });
    expect(options.status).toBe(204);

    const mcp = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" });
    await expect(mcp.json()).resolves.toEqual({ ok: true });
    expect(sdkMocks.Server).toHaveBeenCalled();
    expect(sdkMocks.StreamableHTTPServerTransport).toHaveBeenCalled();

    const missingProfile = await fetch(`http://127.0.0.1:${port}/mcp/missing`, {
      method: "POST",
    });
    expect(missingProfile.status).toBe(404);

    const missing = await fetch(`http://127.0.0.1:${port}/missing`);
    expect(missing.status).toBe(404);

    await expect(startGateway()).resolves.toEqual({
      success: false,
      error: "Gateway is already running",
    });

    await expect(stopGateway()).resolves.toEqual({ success: true });
    expect(serviceMocks.authService.stopProactiveRefresh).toHaveBeenCalled();
    expect(sdkMocks.stdioTransports[0].close).toHaveBeenCalled();
    expect(sdkMocks.httpTransports[0].close).toHaveBeenCalled();
    expect(sdkMocks.sseTransports[0].close).toHaveBeenCalled();
  });

  it("starts with zero tools when no servers are selected", async () => {
    const port = await getFreePort();
    serviceMocks.configService.getPort.mockReturnValue(port);
    serviceMocks.configService.getSelectionState.mockReturnValue({ local: [], remote: [] });
    serviceMocks.configService.getLocalServers.mockReturnValue([localServer()]);
    serviceMocks.configService.getRemoteServers.mockReturnValue([remoteServer()]);
    serviceMocks.configService.getToolFilters.mockReturnValue({});
    serviceMocks.profileService.list.mockReturnValue([]);

    await expect(startGateway()).resolves.toEqual({ success: true });
    expect(getGatewayStatus()).toMatchObject({
      running: true,
      serverCount: 0,
      toolCount: 0,
    });
    expect(sdkMocks.Client).not.toHaveBeenCalled();
  });

  it("returns a failed start result when the listener cannot bind", async () => {
    const blocker = net.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => {
        const address = blocker.address();
        if (!address || typeof address === "string") {
          reject(new Error("Could not allocate blocked port"));
          return;
        }
        resolve(address.port);
      });
    });

    try {
      serviceMocks.configService.getPort.mockReturnValue(port);
      serviceMocks.configService.getSelectionState.mockReturnValue({ local: [], remote: [] });
      serviceMocks.configService.getLocalServers.mockReturnValue([]);
      serviceMocks.configService.getRemoteServers.mockReturnValue([]);
      serviceMocks.configService.getToolFilters.mockReturnValue({});
      serviceMocks.profileService.list.mockReturnValue([]);

      const result = await startGateway();
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/EADDRINUSE|address already in use/i);
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  it("refreshes connected server tools and notifies active sessions", async () => {
    const sendToolListChanged = vi.fn();
    const failingNotify = vi.fn().mockRejectedValue(new Error("notify failed"));
    const firstClient = {
      listTools: vi.fn().mockResolvedValue({
        tools: [
          { name: "keep", description: "Keep" },
          { name: "hide", description: "Hide" },
        ],
      }),
    };
    const secondClient = {
      listTools: vi.fn().mockRejectedValue(new Error("list failed")),
    };
    serviceMocks.configService.getToolFilters.mockReturnValue({
      local1: { disabledTools: ["hide"] },
    });

    setGatewayStateForTests({
      running: true,
      connectedServers: new Map([
        [
          "local1",
          {
            id: "local1",
            name: "Local One",
            type: "local",
            client: firstClient,
            transport: { close: vi.fn() },
            tools: [],
          },
        ],
        [
          "remote:remote1",
          {
            id: "remote:remote1",
            name: "Remote One",
            type: "remote",
            client: secondClient,
            transport: { close: vi.fn() },
            tools: [{ name: "old" }],
          },
        ],
      ]),
      activeSessions: new Map([
        [
          "session-1",
          { server: { sendToolListChanged, close: vi.fn() }, transport: { close: vi.fn() } },
        ],
        [
          "session-2",
          {
            server: { sendToolListChanged: failingNotify, close: vi.fn() },
            transport: { close: vi.fn() },
          },
        ],
      ]),
    });

    await expect(refreshGatewayTools("unit")).resolves.toEqual({ success: true });
    expect(getGatewayStatus().toolCount).toBe(2);
    expect(sendToolListChanged).toHaveBeenCalled();
    expect(failingNotify).toHaveBeenCalled();
  });
});
