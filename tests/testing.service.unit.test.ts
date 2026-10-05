/* global ReadableStream, Response, TextEncoder */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import type { LocalServer, RemoteServer, Server, ToolFilters } from "../src/types/index.js";

const configMocks = vi.hoisted(() => ({
  localServers: [] as any[],
  remoteServers: [] as any[],
  toolFilters: {} as Record<string, any>,
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
    hasValidToken: vi.fn(),
    getPendingAuthState: vi.fn(),
  },
}));

const envMocks = vi.hoisted(() => ({
  service: {
    getShellCommand: vi.fn(),
    shouldUseZsh: vi.fn(),
  },
}));

const childProcessMocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

const sdkMocks = vi.hoisted(() => {
  const clientInstances: any[] = [];
  const transportInstances: any[] = [];
  const Client = vi.fn(function () {
    const instance = {
      connect: vi.fn(),
      listTools: vi.fn(),
      close: vi.fn(),
    };
    clientInstances.push(instance);
    return instance;
  });
  const SSEClientTransport = vi.fn(function (url: URL, options: unknown) {
    const instance = { url, options };
    transportInstances.push(instance);
    return instance;
  });
  return {
    Client,
    SSEClientTransport,
    clientInstances,
    transportInstances,
  };
});

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof configMocks.service => configMocks.service,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: (): typeof authMocks.service => authMocks.service,
}));

vi.mock("../src/services/environment.service.js", () => ({
  getEnvironmentService: (): typeof envMocks.service => envMocks.service,
}));

vi.mock("child_process", () => ({
  spawn: childProcessMocks.spawn,
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: sdkMocks.Client,
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: sdkMocks.SSEClientTransport,
}));

import {
  getTestingService,
  resetTestingService,
  TestingService,
} from "../src/services/testing.service.js";

function localServer(overrides: Partial<LocalServer> = {}): LocalServer {
  return {
    id: "local",
    name: "Local",
    command: "node",
    args: ["server.js"],
    ...overrides,
  };
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

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

function createProcess(): EventEmitter & {
  stdout: EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
} {
  const process = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  process.stdout = new EventEmitter();
  process.stdin = { write: vi.fn() };
  process.kill = vi.fn();
  return process;
}

function resetMocks(): void {
  configMocks.localServers = [];
  configMocks.remoteServers = [];
  configMocks.toolFilters = {};
  configMocks.service.getServerToolFilter.mockImplementation(
    (filterId: string) => configMocks.toolFilters[filterId]
  );
  configMocks.service.setServerToolFilter.mockImplementation((filterId: string, filter: any) => {
    configMocks.toolFilters[filterId] = filter;
  });
  configMocks.service.updateRemoteServer.mockImplementation(
    (serverId: string, patch: Partial<RemoteServer>) => {
      configMocks.remoteServers = configMocks.remoteServers.map((server) =>
        server.id === serverId ? { ...server, ...patch } : server
      );
    }
  );
  configMocks.service.getToolFilters.mockImplementation(() => configMocks.toolFilters);
  configMocks.service.getLocalServers.mockImplementation(() => configMocks.localServers);
  configMocks.service.getRemoteServers.mockImplementation(() => configMocks.remoteServers);

  authMocks.service.getValidToken.mockResolvedValue(undefined);
  authMocks.service.parseWWWAuthenticate.mockReturnValue({
    requiresAuth: true,
    resourceMetadataUrl: "https://auth.test/.well-known/oauth-protected-resource",
  });
  authMocks.service.startOAuthFlow.mockResolvedValue({
    authUrl: "https://auth.test/authorize",
    state: "state",
  });
  authMocks.service.waitForAuth.mockResolvedValue({ success: true });
  authMocks.service.stopCallbackServer.mockImplementation(() => undefined);
  authMocks.service.hasValidToken.mockReturnValue(false);
  authMocks.service.getPendingAuthState.mockReturnValue("state");

  envMocks.service.getShellCommand.mockReturnValue("/bin/zsh");
  envMocks.service.shouldUseZsh.mockReturnValue(false);

  childProcessMocks.spawn.mockReset();
  sdkMocks.Client.mockClear();
  sdkMocks.SSEClientTransport.mockClear();
  sdkMocks.clientInstances.length = 0;
  sdkMocks.transportInstances.length = 0;
}

describe("TestingService unit coverage", () => {
  let service: TestingService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
    resetTestingService();
    service = new TestingService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetTestingService();
  });

  it("tests a local server through direct spawn and records discovered tools", async () => {
    const process = createProcess();
    childProcessMocks.spawn.mockReturnValue(process);

    const resultPromise = service.testLocalServer(localServer());
    process.stdout.emit(
      "data",
      Buffer.from(
        `${JSON.stringify({
          result: {
            tools: [{ name: "search", description: "Search docs" }],
          },
        })}\n`
      )
    );

    await expect(resultPromise).resolves.toEqual({ success: true, toolCount: 1 });
    expect(childProcessMocks.spawn).toHaveBeenCalledWith("node", ["server.js"], {
      env: expect.any(Object),
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(configMocks.toolFilters.local.allTools).toEqual(["search"]);
    expect(configMocks.toolFilters.local.toolsData.search.tokens).toBeGreaterThan(0);
  });

  it("uses zsh for local shell-style commands when available", async () => {
    envMocks.service.shouldUseZsh.mockReturnValue(true);
    const process = createProcess();
    childProcessMocks.spawn.mockReturnValue(process);

    const resultPromise = service.testLocalServer(
      localServer({
        command: "/usr/local/bin/start-server",
        args: ["--stdio"],
        env: { API_KEY: "secret" },
      })
    );
    process.emit("close", 7);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      error: "Exited with code 7",
      toolCount: 0,
    });
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "/bin/zsh",
      ["-c", "/usr/local/bin/start-server --stdio"],
      {
        env: expect.objectContaining({ API_KEY: "secret" }),
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  });

  it("records spawn errors for local servers", async () => {
    const process = createProcess();
    childProcessMocks.spawn.mockReturnValue(process);

    const resultPromise = service.testLocalServer(localServer());
    process.emit("error", new Error("spawn failed"));

    await expect(resultPromise).resolves.toEqual({
      success: false,
      error: "spawn failed",
      toolCount: 0,
    });
    expect(configMocks.toolFilters.local.error).toBe("spawn failed");
  });

  it("tests remote HTTP servers with auth headers, session IDs, and JSON tools", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    authMocks.service.getValidToken.mockResolvedValue("oauth-token");
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          { result: {} },
          {
            headers: {
              "mcp-session-id": "session-1",
            },
          }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            tools: [{ name: "fetch", description: "Fetch URL" }],
          },
        })
      );

    const result = await service.testRemoteServer(
      remoteServer({
        oauth: { enabled: true },
        headers: { "X-Custom": "value" },
      })
    );

    expect(result).toEqual({ success: true, toolCount: 1 });
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Custom": "value",
      Authorization: "Bearer oauth-token",
    });
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      "mcp-session-id": "session-1",
    });
    expect(configMocks.toolFilters["remote:remote"].allTools).toEqual(["fetch"]);
  });

  it("prefers static bearer tokens over OAuth tokens", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock.mockResolvedValueOnce(jsonResponse({ result: {} })).mockResolvedValueOnce(
      jsonResponse({
        result: {
          tools: [],
        },
      })
    );

    await service.testRemoteServer(
      remoteServer({
        bearerToken: "static-token",
        oauth: { enabled: true },
      })
    );

    expect(authMocks.service.getValidToken).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer static-token");
  });

  it("handles remote HTTP error responses and missing tool lists", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({}, { status: 503 }));
    await expect(service.testRemoteServer(remoteServer())).resolves.toEqual({
      success: false,
      error: "HTTP 503",
      toolCount: 0,
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: {} }))
      .mockResolvedValueOnce(jsonResponse({ result: {} }, { status: 502 }));
    await expect(service.testRemoteServer(remoteServer({ id: "remote-502" }))).resolves.toEqual({
      success: false,
      error: "HTTP 502",
      toolCount: 0,
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: {} }))
      .mockResolvedValueOnce(jsonResponse({ result: {} }));
    await expect(service.testRemoteServer(remoteServer({ id: "remote-empty" }))).resolves.toEqual({
      success: false,
      error: "No tools in response",
      toolCount: 0,
    });
  });

  it("handles unauthorized HTTP responses with and without callback-driven OAuth", async () => {
    const unauthorized = new Response("unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer resource_metadata="https://auth.test/meta"',
      },
    });
    globalThis.fetch = vi.fn().mockResolvedValue(unauthorized);

    await expect(service.testRemoteServer(remoteServer(), true)).resolves.toEqual({
      success: false,
      error: "HTTP 401 - Authentication required",
      toolCount: 0,
      requiresAuth: true,
    });

    await expect(service.testRemoteServer(remoteServer())).resolves.toMatchObject({
      success: false,
      error: "Authentication required",
      toolCount: 0,
      requiresAuth: true,
    });

    service.setAuthCallback(async (server, authUrl, onComplete) => {
      expect(server.id).toBe("remote-oauth");
      expect(authUrl).toBe("https://auth.test/authorize");
      expect(service.hasAuthInProgress("remote-oauth")).toBe(true);
      await onComplete();
      return true;
    });

    await expect(
      service.testRemoteServer(remoteServer({ id: "remote-oauth", oauth: { enabled: true } }))
    ).resolves.toMatchObject({
      success: false,
      error: "Authentication in progress",
      toolCount: 0,
      requiresAuth: true,
      authInProgress: true,
    });
    expect(service.hasAuthInProgress("remote-oauth")).toBe(false);
  });

  it("parses streamable HTTP SSE responses and reports malformed streams", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: {} }))
      .mockResolvedValueOnce(
        sseResponse([
          "event: message\n",
          "data: not-json\n\n",
          'data: {"result":{"tools":[{"name":"stream"}]}}\n\n',
        ])
      );

    await expect(service.testRemoteServer(remoteServer({ id: "remote-sse" }))).resolves.toEqual({
      success: true,
      toolCount: 1,
    });
    expect(configMocks.toolFilters["remote:remote-sse"].allTools).toEqual(["stream"]);

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: {} }))
      .mockResolvedValueOnce(
        new Response(null, { headers: { "content-type": "text/event-stream" } })
      );
    await expect(
      service.testRemoteServer(remoteServer({ id: "remote-sse-empty-body" }))
    ).resolves.toEqual({
      success: false,
      error: "No response body for SSE",
      toolCount: 0,
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: {} }))
      .mockResolvedValueOnce(sseResponse(["data: [DONE]\n\n"]));
    await expect(
      service.testRemoteServer(remoteServer({ id: "remote-sse-no-json" }))
    ).resolves.toEqual({
      success: false,
      error: "No JSON data in SSE response",
      toolCount: 0,
    });
  });

  it("normalizes fetch aborts into timeout errors", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    await expect(service.testRemoteServer(remoteServer())).resolves.toEqual({
      success: false,
      error: "Timeout",
      toolCount: 0,
    });
  });

  it("tests SSE servers through the MCP SDK transport", async () => {
    const server = remoteServer({ type: "sse", url: "https://example.test/sse" });
    sdkMocks.Client.mockImplementationOnce(function () {
      const instance = {
        connect: vi.fn(),
        listTools: vi.fn().mockResolvedValue({ tools: [{ name: "events" }] }),
        close: vi.fn(),
      };
      sdkMocks.clientInstances.push(instance);
      return instance;
    });

    await expect(service.testRemoteServer(server)).resolves.toEqual({
      success: true,
      toolCount: 1,
    });
    expect(sdkMocks.SSEClientTransport).toHaveBeenCalledWith(new URL("https://example.test/sse"), {
      requestInit: {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
      },
    });
    expect(configMocks.toolFilters["remote:remote"].allTools).toEqual(["events"]);
  });

  it("handles SSE SDK authentication and timeout failures", async () => {
    sdkMocks.Client.mockImplementationOnce(function () {
      const instance = {
        connect: vi.fn().mockRejectedValue(new Error("401 Unauthorized")),
        listTools: vi.fn(),
        close: vi.fn(),
      };
      sdkMocks.clientInstances.push(instance);
      return instance;
    });

    await expect(
      service.testRemoteServer(remoteServer({ id: "sse-auth", type: "sse" }), true)
    ).resolves.toEqual({
      success: false,
      error: "HTTP 401 - Authentication required",
      toolCount: 0,
      requiresAuth: true,
    });

    sdkMocks.Client.mockImplementationOnce(function () {
      const instance = {
        connect: vi.fn().mockRejectedValue(new Error("Timeout")),
        listTools: vi.fn(),
        close: vi.fn(),
      };
      sdkMocks.clientInstances.push(instance);
      return instance;
    });

    await expect(
      service.testRemoteServer(remoteServer({ id: "sse-timeout", type: "sse" }))
    ).resolves.toEqual({
      success: false,
      error: "Timeout",
      toolCount: 0,
    });
  });

  it("auto-enables OAuth, completes auth, and retests in testAndAuthenticate", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    fetchMock
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ result: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            tools: [{ name: "after-auth" }],
          },
        })
      );
    const onAuthUrl = vi.fn();
    const server = remoteServer({ oauth: undefined });

    await expect(service.testAndAuthenticate(server, onAuthUrl)).resolves.toEqual({
      success: true,
      toolCount: 1,
    });
    expect(configMocks.service.updateRemoteServer).toHaveBeenCalledWith("remote", {
      oauth: { enabled: true },
    });
    expect(onAuthUrl).toHaveBeenCalledWith("https://auth.test/authorize");
    expect(authMocks.service.waitForAuth).toHaveBeenCalledWith("state");
    expect(authMocks.service.stopCallbackServer).toHaveBeenCalled();
  });

  it("reports failed and unsupported OAuth flows in testAndAuthenticate", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    authMocks.service.startOAuthFlow.mockResolvedValueOnce(null);

    await expect(service.testAndAuthenticate(remoteServer(), vi.fn())).resolves.toEqual({
      success: false,
      error: "Failed to start OAuth flow - server may not support OAuth discovery",
      toolCount: 0,
      requiresAuth: true,
    });

    authMocks.service.startOAuthFlow.mockResolvedValueOnce({
      authUrl: "https://auth.test/authorize",
      state: "failed-state",
    });
    authMocks.service.waitForAuth.mockResolvedValueOnce({ success: false, error: "denied" });

    await expect(service.testAndAuthenticate(remoteServer(), vi.fn())).resolves.toEqual({
      success: false,
      error: "Authentication failed: denied",
      toolCount: 0,
      requiresAuth: true,
    });
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
