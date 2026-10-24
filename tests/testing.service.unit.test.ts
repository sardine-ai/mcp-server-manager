import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LocalServer,
  RemoteServer,
  Server,
  ToolFilters,
  ServerToolFilter,
} from "../src/types/index.js";

const configMocks = vi.hoisted(() => ({
  localServers: [] as LocalServer[],
  remoteServers: [] as RemoteServer[],
  toolFilters: {} as ToolFilters,
  service: {
    getServerToolFilter: vi.fn(),
    setServerToolFilter: vi.fn(),
    updateRemoteServer: vi.fn(),
    getToolFilters: vi.fn(),
    getLocalServers: vi.fn(),
    getRemoteServers: vi.fn(),
  },
}));
const authMocks = vi.hoisted(() => ({
  service: {
    getValidToken: vi.fn(),
    parseWWWAuthenticate: vi.fn(),
    startOAuthFlow: vi.fn(),
    waitForAuth: vi.fn(),
    stopCallbackServer: vi.fn(),
    releaseOAuthFlow: vi.fn(),
    hasValidToken: vi.fn(),
    getPendingAuthState: vi.fn(),
  },
}));
const connectionMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  close: vi.fn(),
  create: vi.fn(),
}));
vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof configMocks.service => configMocks.service,
}));
vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: (): typeof authMocks.service => authMocks.service,
}));
vi.mock("../src/services/mcp-connection.js", () => ({
  createMcpConnection: connectionMocks.create,
  closeMcpConnection: connectionMocks.close,
}));
import {
  getTestingService,
  resetTestingService,
  TestingService,
} from "../src/services/testing.service.js";

function localServer(overrides: Partial<LocalServer> = {}): LocalServer {
  return { id: "local", name: "Local", command: "node", args: ["server.js"], ...overrides };
}
function remoteServer(overrides: Partial<RemoteServer> = {}): RemoteServer {
  return {
    id: "remote",
    name: "Remote",
    type: "http",
    url: "https://example.test/mcp",
    ...overrides,
  };
}

describe("TestingService unit coverage", () => {
  let service: TestingService;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    configMocks.localServers = [];
    configMocks.remoteServers = [];
    configMocks.toolFilters = {};
    configMocks.service.getServerToolFilter.mockImplementation(
      (id: string) => configMocks.toolFilters[id]
    );
    configMocks.service.setServerToolFilter.mockImplementation(
      (id: string, filter: ServerToolFilter) => {
        configMocks.toolFilters[id] = filter;
      }
    );
    configMocks.service.getToolFilters.mockImplementation(() => configMocks.toolFilters);
    configMocks.service.getLocalServers.mockImplementation(() => configMocks.localServers);
    configMocks.service.getRemoteServers.mockImplementation(() => configMocks.remoteServers);
    configMocks.service.updateRemoteServer.mockReturnValue({ success: true });
    authMocks.service.getValidToken.mockResolvedValue(undefined);
    authMocks.service.startOAuthFlow.mockResolvedValue({
      authUrl: "https://auth.test/authorize",
      state: "state",
    });
    authMocks.service.waitForAuth.mockResolvedValue({ success: true });
    authMocks.service.getPendingAuthState.mockReturnValue("state");
    connectionMocks.connect.mockResolvedValue(undefined);
    connectionMocks.listTools.mockResolvedValue({ tools: [] });
    connectionMocks.close.mockResolvedValue(undefined);
    connectionMocks.create.mockReturnValue({
      client: { connect: connectionMocks.connect, listTools: connectionMocks.listTools },
      transport: {},
    });
    resetTestingService();
    service = new TestingService();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetTestingService();
  });

  it("stores tool annotations from discovered tools", async () => {
    connectionMocks.listTools.mockResolvedValue({
      tools: [{ name: "search", annotations: { readOnlyHint: true } }, { name: "plain" }],
    });
    await service.testLocalServer(localServer());
    expect(configMocks.toolFilters.local.toolsData.search.annotations).toEqual({
      readOnlyHint: true,
    });
    expect(configMocks.toolFilters.local.toolsData.plain.annotations).toBeUndefined();
  });

  it.each(["local", "http", "sse"])(
    "discovers %s tools and preserves disabled tools",
    async (type) => {
      connectionMocks.listTools.mockResolvedValue({
        tools: [{ name: "search", description: "Search docs" }],
      });
      const id = type === "local" ? "local" : "remote:remote";
      configMocks.toolFilters[id] = {
        enabled: [],
        disabledTools: ["search"],
        allTools: ["search"],
      };
      const result =
        type === "local"
          ? await service.testLocalServer(localServer())
          : await service.testRemoteServer(remoteServer({ type: type === "sse" ? "sse" : "http" }));
      expect(result).toEqual({ success: true, toolCount: 1 });
      expect(configMocks.toolFilters[id]).toMatchObject({
        allTools: ["search"],
        disabledTools: ["search"],
      });
      expect(connectionMocks.close).toHaveBeenCalledOnce();
    }
  );
  it.each(["connect", "listTools"] as const)("closes after %s fails", async (method) => {
    connectionMocks[method].mockRejectedValue(new Error("broken"));
    await expect(service.testLocalServer(localServer())).resolves.toMatchObject({
      success: false,
      error: "broken",
    });
    expect(connectionMocks.close).toHaveBeenCalledOnce();
  });
  it("keeps an end-to-end deadline and closes a stalled connection", async () => {
    vi.useFakeTimers();
    connectionMocks.connect.mockImplementation(() => new Promise(() => {}));
    const pending = service.testLocalServer(localServer());
    await vi.advanceTimersByTimeAsync(8000);
    await expect(pending).resolves.toMatchObject({ success: false, error: "Timeout" });
    expect(connectionMocks.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses static bearer authentication without interactive login", async () => {
    await service.testRemoteServer(
      remoteServer({ bearerToken: "fixture-token", oauth: { enabled: true } })
    );
    expect(connectionMocks.create).toHaveBeenCalledWith(
      expect.anything(),
      "test",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer fixture-token" }),
      })
    );
    expect(authMocks.service.startOAuthFlow).not.toHaveBeenCalled();
  });
  it("preserves OAuth options and reports phases", async () => {
    vi.spyOn(service, "testRemoteServer")
      .mockResolvedValueOnce({ success: false, requiresAuth: true, toolCount: 0 })
      .mockResolvedValueOnce({ success: true, toolCount: 1 });
    const phase = vi.fn();
    const onUrl = vi.fn();
    const server = remoteServer({
      oauth: { enabled: false, clientId: "client", scopes: ["read"] },
    });
    await expect(service.testAndAuthenticate(server, onUrl, { onPhase: phase })).resolves.toEqual({
      success: true,
      toolCount: 1,
    });
    expect(configMocks.service.updateRemoteServer).toHaveBeenCalledWith("remote", {
      oauth: { enabled: true, clientId: "client", scopes: ["read"] },
    });
    expect(phase.mock.calls.flat()).toEqual([
      "testing",
      "authorization-required",
      "waiting",
      "retesting",
    ]);
    expect(onUrl).toHaveBeenCalledWith("https://auth.test/authorize");
    expect(authMocks.service.releaseOAuthFlow).toHaveBeenCalledWith("state");
  });
  it.each(["denied", "browser failed"])("releases its flow after %s", async (reason) => {
    vi.spyOn(service, "testRemoteServer").mockResolvedValue({
      success: false,
      requiresAuth: true,
      toolCount: 0,
    });
    authMocks.service.waitForAuth.mockResolvedValue({ success: false, error: "denied" });
    const onUrl = vi.fn(async () => {
      if (reason === "browser failed") throw new Error(reason);
    });
    await expect(service.testAndAuthenticate(remoteServer(), onUrl)).resolves.toMatchObject({
      success: false,
    });
    expect(authMocks.service.releaseOAuthFlow).toHaveBeenCalledWith("state");
  });

  it("retries testRemoteServerWithAuth when auth is in progress", async () => {
    const testRemoteServer = vi
      .spyOn(service, "testRemoteServer")
      .mockResolvedValueOnce({
        success: false,
        error: "Authentication in progress",
        toolCount: 0,
        requiresAuth: true,
        authInProgress: true,
      })
      .mockResolvedValueOnce({ success: true, toolCount: 2 });

    await expect(service.testRemoteServerWithAuth(remoteServer())).resolves.toEqual({
      success: true,
      toolCount: 2,
    });
    expect(authMocks.service.getPendingAuthState).toHaveBeenCalledWith("remote");
    expect(authMocks.service.waitForAuth).toHaveBeenCalledWith("state");
    expect(testRemoteServer).toHaveBeenCalledTimes(2);
  });

  it("selects servers by tool discovery and OAuth requirements", () => {
    configMocks.localServers = [localServer({ id: "known" }), localServer({ id: "unknown" })];
    configMocks.remoteServers = [
      remoteServer({ id: "remote-known" }),
      remoteServer({ id: "remote-unknown", oauth: { enabled: true } }),
    ];
    configMocks.toolFilters = {
      known: { allTools: ["tool"] },
      "remote:remote-known": { allTools: ["tool"] },
    } satisfies ToolFilters;

    expect(service.getServersWithoutTools()).toEqual({
      local: [expect.objectContaining({ id: "unknown" })],
      remote: [expect.objectContaining({ id: "remote-unknown" })],
    });
    expect(service.getServersRequiringAuth()).toEqual([
      expect.objectContaining({ id: "remote-unknown" }),
    ]);
  });

  it("dispatches local and remote testing helpers", async () => {
    const local = localServer();
    const remote = remoteServer();
    vi.spyOn(service, "testLocalServer").mockResolvedValue({ success: true, toolCount: 1 });
    vi.spyOn(service, "testRemoteServer").mockResolvedValue({ success: true, toolCount: 2 });

    await expect(service.testServer(local, "local")).resolves.toEqual({
      success: true,
      toolCount: 1,
    });
    await expect(service.testServer(remote, "remote")).resolves.toEqual({
      success: true,
      toolCount: 2,
    });
  });

  it("tests all servers and streams results with stable indexes", async () => {
    const local = localServer();
    const remote = remoteServer();
    configMocks.localServers = [local];
    configMocks.remoteServers = [remote];
    vi.spyOn(service, "testLocalServer").mockResolvedValue({ success: true, toolCount: 1 });
    vi.spyOn(service, "testRemoteServer").mockResolvedValue({ success: true, toolCount: 2 });

    await expect(service.testAllServers()).resolves.toEqual([
      { server: local as Server, type: "local", result: { success: true, toolCount: 1 } },
      { server: remote as Server, type: "remote", result: { success: true, toolCount: 2 } },
    ]);

    const onResult = vi.fn();
    const streamed = await service.testAllServersStreaming(onResult);
    expect(streamed).toHaveLength(2);
    expect(onResult).toHaveBeenCalledWith({
      server: local,
      type: "local",
      result: { success: true, toolCount: 1 },
      index: 0,
      total: 2,
    });
    expect(onResult).toHaveBeenCalledWith({
      server: remote,
      type: "remote",
      result: { success: true, toolCount: 2 },
      index: 1,
      total: 2,
    });
  });

  it("auto-tests unknown servers only and resets the singleton instance", async () => {
    configMocks.localServers = [localServer({ id: "unknown-local" })];
    configMocks.remoteServers = [remoteServer({ id: "unknown-remote" })];
    const testLocal = vi.spyOn(service, "testLocalServer").mockResolvedValue({
      success: true,
      toolCount: 1,
    });
    const testRemote = vi.spyOn(service, "testRemoteServer").mockResolvedValue({
      success: true,
      toolCount: 1,
    });

    await service.autoTestUnknownServers();
    expect(testLocal).toHaveBeenCalledWith(expect.objectContaining({ id: "unknown-local" }));
    expect(testRemote).toHaveBeenCalledWith(expect.objectContaining({ id: "unknown-remote" }));

    const first = getTestingService();
    expect(getTestingService()).toBe(first);
    resetTestingService();
    expect(getTestingService()).not.toBe(first);
  });

  it("authenticates OAuth servers and reports skipped or failed cases", async () => {
    const servers = [
      remoteServer({ id: "valid", oauth: { enabled: true } }),
      remoteServer({ id: "no-auth-needed", oauth: { enabled: true } }),
      remoteServer({ id: "not-auth-error", oauth: { enabled: true } }),
      remoteServer({ id: "no-flow", oauth: { enabled: true } }),
      remoteServer({ id: "auth-ok", oauth: { enabled: true } }),
      remoteServer({ id: "auth-failed", oauth: { enabled: true } }),
    ];
    configMocks.remoteServers = servers;
    authMocks.service.hasValidToken.mockImplementation((serverId: string) => serverId === "valid");
    authMocks.service.startOAuthFlow.mockImplementation((server: RemoteServer) =>
      server.id === "no-flow"
        ? null
        : { authUrl: `https://auth.test/${server.id}`, state: server.id }
    );
    authMocks.service.waitForAuth.mockImplementation((state: string) =>
      state === "auth-failed" ? { success: false, error: "denied" } : { success: true }
    );
    vi.spyOn(service, "testRemoteServer").mockImplementation((server: RemoteServer) => {
      if (server.id === "no-auth-needed") {
        return Promise.resolve({ success: true, toolCount: 0 });
      }
      if (server.id === "not-auth-error") {
        return Promise.resolve({ success: false, error: "HTTP 500", toolCount: 0 });
      }
      return Promise.resolve({
        success: false,
        error: "HTTP 401 - Authentication required",
        toolCount: 0,
        requiresAuth: true,
      });
    });
    const onAuthRequired = vi.fn();
    const onProgress = vi.fn();

    await expect(service.checkAndAuthenticateServers(onAuthRequired, onProgress)).resolves.toEqual({
      authenticated: ["auth-ok"],
      failed: ["not-auth-error", "no-flow", "auth-failed"],
      skipped: ["valid", "no-auth-needed"],
    });
    expect(onAuthRequired).toHaveBeenCalledWith(
      expect.objectContaining({ id: "auth-ok" }),
      "https://auth.test/auth-ok"
    );
    expect(onProgress).toHaveBeenCalledWith("Checking Remote...");
    expect(onProgress).toHaveBeenCalledWith("Remote authenticated successfully");
  });

  it("retests remote servers after interactive auth in testAllServersWithAuth", async () => {
    const remote = remoteServer({ id: "needs-auth", oauth: { enabled: true } });
    configMocks.localServers = [localServer()];
    configMocks.remoteServers = [remote];
    vi.spyOn(service, "testLocalServer").mockResolvedValue({ success: true, toolCount: 1 });
    vi.spyOn(service, "testRemoteServer")
      .mockResolvedValueOnce({
        success: false,
        error: "Authentication in progress",
        toolCount: 0,
        requiresAuth: true,
        authInProgress: true,
      })
      .mockResolvedValueOnce({ success: true, toolCount: 3 });

    const onAuthRequired = vi.fn();

    await expect(service.testAllServersWithAuth(onAuthRequired)).resolves.toEqual([
      {
        server: expect.objectContaining({ id: "local" }),
        type: "local",
        result: { success: true, toolCount: 1 },
      },
      {
        server: remote,
        type: "remote",
        result: { success: true, toolCount: 3 },
      },
    ]);
    expect(onAuthRequired).toHaveBeenCalledWith(remote, "https://auth.test/authorize");
  });
});
