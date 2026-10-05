/* global Response */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { AuthService, resetAuthService } from "../src/services/auth.service.js";
import type {
  AuthServerMetadata,
  PendingAuthorization,
  RemoteServer,
  StoredOAuthTokens,
} from "../src/types/index.js";

type AuthServiceInternals = AuthService & {
  pendingAuths: Map<string, PendingAuthorization>;
  tokens: Map<string, StoredOAuthTokens>;
  refreshRetryCounts: Map<string, number>;
  savePendingAuths: () => void;
};

const AUTH_METADATA: AuthServerMetadata = {
  issuer: "https://auth.test",
  authorization_endpoint: "https://auth.test/authorize",
  token_endpoint: "https://auth.test/token",
  scopes_supported: ["tools.read", "tools.write"],
};

function remoteServer(overrides: Partial<RemoteServer> = {}): RemoteServer {
  return {
    id: "remote",
    name: "Remote",
    type: "http",
    url: "https://api.test/mcp",
    ...overrides,
  };
}

function token(overrides: Partial<StoredOAuthTokens> = {}): StoredOAuthTokens {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "Bearer",
    ...overrides,
  };
}

function pendingAuth(overrides: Partial<PendingAuthorization> = {}): PendingAuthorization {
  return {
    serverId: "remote",
    serverUrl: "https://api.test/mcp",
    pkce: {
      codeVerifier: "verifier",
      codeChallenge: "challenge",
      codeChallengeMethod: "S256",
    },
    state: "state",
    redirectUri: "http://127.0.0.1:8400/callback",
    authorizationEndpoint: "https://auth.test/authorize",
    tokenEndpoint: "https://auth.test/token",
    clientId: "client",
    clientSecret: "secret",
    scopes: ["tools.read"],
    createdAt: Date.now(),
    ...overrides,
  };
}

function responseJson(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function requestText(url: string): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode, body });
        });
      })
      .on("error", reject);
  });
}

describe("AuthService unit coverage", () => {
  let configDir: string;
  let service: AuthService;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-auth-unit-"));
    service = new AuthService(configDir);
  });

  afterEach(() => {
    service.stopCallbackServer();
    resetAuthService();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("generates PKCE data and state values", () => {
    const pkce = service.generatePKCE();
    const state = service.generateState();

    expect(pkce.codeVerifier).toHaveLength(64);
    expect(pkce.codeChallenge.length).toBeGreaterThan(20);
    expect(pkce.codeChallengeMethod).toBe("S256");
    expect(state).toHaveLength(32);
  });

  it("returns minimal requirements for non-bearer WWW-Authenticate headers", () => {
    expect(service.parseWWWAuthenticate('Basic realm="legacy"')).toEqual({
      requiresAuth: true,
    });
  });

  it("fetches protected-resource metadata from explicit and well-known URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        responseJson({
          resource: "https://api.test/mcp",
          authorization_servers: ["https://auth.test"],
        })
      )
      .mockResolvedValueOnce(responseJson({ resource: "https://api.test/custom" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service.fetchProtectedResourceMetadata("https://api.test/mcp")).resolves.toEqual({
      resource: "https://api.test/mcp",
      authorization_servers: ["https://auth.test"],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.test/.well-known/oauth-protected-resource/mcp"
    );

    await expect(
      service.fetchProtectedResourceMetadata("https://api.test/mcp", "https://meta.test/custom")
    ).resolves.toEqual({ resource: "https://api.test/custom" });
    expect(fetchMock.mock.calls[1][0]).toBe("https://meta.test/custom");
  });

  it("returns null when protected-resource metadata cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 })));
    await expect(service.fetchProtectedResourceMetadata("https://api.test")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network")));
    await expect(service.fetchProtectedResourceMetadata("not a url")).resolves.toBeNull();
  });

  it("tries auth-server metadata endpoints until one has required endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(responseJson({ issuer: "https://auth.test" }))
      .mockResolvedValueOnce(responseJson(AUTH_METADATA));
    vi.stubGlobal("fetch", fetchMock);

    await expect(service.fetchAuthServerMetadata("https://auth.test/custom")).resolves.toEqual(
      AUTH_METADATA
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://auth.test/.well-known/oauth-authorization-server/custom"
    );
  });

  it("returns null for invalid auth-server URLs or exhausted metadata endpoints", async () => {
    await expect(service.fetchAuthServerMetadata("not a url")).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(service.fetchAuthServerMetadata("https://auth.test")).resolves.toBeNull();
  });

  it("discovers authorization servers from protected metadata, config, or server origin", async () => {
    const fetchProtected = vi
      .spyOn(service, "fetchProtectedResourceMetadata")
      .mockResolvedValueOnce({
        resource: "https://api.test",
        authorization_servers: ["https://resource-auth.test"],
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const fetchAuth = vi.spyOn(service, "fetchAuthServerMetadata").mockResolvedValue(AUTH_METADATA);

    await expect(service.discoverAuthServer(remoteServer())).resolves.toEqual({
      metadata: AUTH_METADATA,
      resourceMetadata: {
        resource: "https://api.test",
        authorization_servers: ["https://resource-auth.test"],
      },
    });
    expect(fetchAuth).toHaveBeenLastCalledWith("https://resource-auth.test");

    await expect(
      service.discoverAuthServer(
        remoteServer({ oauth: { enabled: true, authServerUrl: "https://configured-auth.test" } })
      )
    ).resolves.toEqual({ metadata: AUTH_METADATA, resourceMetadata: undefined });
    expect(fetchAuth).toHaveBeenLastCalledWith("https://configured-auth.test");

    await expect(service.discoverAuthServer(remoteServer())).resolves.toEqual({
      metadata: AUTH_METADATA,
      resourceMetadata: undefined,
    });
    expect(fetchAuth).toHaveBeenLastCalledWith("https://api.test");
    expect(fetchProtected).toHaveBeenCalledTimes(3);
  });

  it("returns null when auth discovery cannot resolve metadata", async () => {
    vi.spyOn(service, "fetchProtectedResourceMetadata").mockResolvedValue(null);
    vi.spyOn(service, "fetchAuthServerMetadata").mockResolvedValue(null);

    await expect(service.discoverAuthServer(remoteServer())).resolves.toBeNull();
    await expect(
      service.discoverAuthServer(remoteServer({ url: "not a url" }))
    ).resolves.toBeNull();
  });

  it("registers OAuth clients and handles registration failures", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      responseJson({
        client_id: "registered-client",
        client_secret: "registered-secret",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      service.registerClient("https://auth.test/register", "http://127.0.0.1:8400/callback")
    ).resolves.toEqual({
      client_id: "registered-client",
      client_secret: "registered-secret",
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      redirect_uris: ["http://127.0.0.1:8400/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response("denied", {
          status: 400,
        })
      )
    );
    await expect(
      service.registerClient("https://auth.test/register", "http://127.0.0.1:8400/callback")
    ).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network")));
    await expect(
      service.registerClient("https://auth.test/register", "http://127.0.0.1:8400/callback")
    ).resolves.toBeNull();
  });

  it("builds authorization URLs and persists pending authorization state", async () => {
    const result = await service.buildAuthorizationUrl(
      remoteServer({ oauth: { enabled: true, scopes: ["server-scope"] } }),
      AUTH_METADATA,
      "http://127.0.0.1:8400/callback",
      "client-id",
      "client-secret",
      ["explicit-scope"]
    );
    const url = new URL(result.url);

    expect(url.origin + url.pathname).toBe("https://auth.test/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8400/callback");
    expect(url.searchParams.get("scope")).toBe("explicit-scope");
    expect(url.searchParams.get("resource")).toBe("https://api.test/mcp");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(service.getPendingAuthState("remote")).toBe(result.state);

    const reloaded = new AuthService(configDir);
    expect(reloaded.getPendingAuthState("remote")).toBe(result.state);
  });

  it("starts OAuth flows with dynamic registration and redirect-URI fallback clients", async () => {
    vi.spyOn(service, "startCallbackServer").mockResolvedValue("http://127.0.0.1:8400/callback");
    vi.spyOn(service, "discoverAuthServer").mockResolvedValueOnce({
      metadata: { ...AUTH_METADATA, registration_endpoint: "https://auth.test/register" },
      resourceMetadata: {
        resource: "https://api.test/mcp",
        scopes_supported: ["resource-scope"],
      },
    });
    vi.spyOn(service, "registerClient").mockResolvedValueOnce({
      client_id: "registered-client",
      client_secret: "registered-secret",
    });

    const registered = await service.startOAuthFlow(remoteServer());
    expect(registered?.authUrl).toContain("client_id=registered-client");
    expect(registered?.state).toBeTruthy();
    expect(
      (service as unknown as AuthServiceInternals).pendingAuths.get(registered?.state ?? "")
        ?.clientSecret
    ).toBe("registered-secret");

    vi.spyOn(service, "discoverAuthServer").mockResolvedValueOnce({
      metadata: AUTH_METADATA,
    });
    const fallback = await service.startOAuthFlow(remoteServer({ id: "fallback" }));
    expect(fallback?.authUrl).toContain("client_id=http%3A%2F%2F127.0.0.1%3A8400%2Fcallback");

    vi.spyOn(service, "discoverAuthServer").mockResolvedValueOnce(null);
    await expect(service.startOAuthFlow(remoteServer({ id: "none" }))).resolves.toBeNull();
  });

  it("waits for authorization completion, timeout, or missing state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const internals = service as unknown as AuthServiceInternals;
    internals.pendingAuths.set("state", pendingAuth({ createdAt: 1_000 }));

    const success = service.waitForAuth("state", 2_000);
    internals.tokens.set("remote", token({ accessToken: "new-access" }));
    internals.pendingAuths.delete("state");
    await vi.advanceTimersByTimeAsync(500);
    await expect(success).resolves.toMatchObject({
      success: true,
      token: "new-access",
    });

    internals.pendingAuths.set("timeout", pendingAuth({ state: "timeout", createdAt: Date.now() }));
    const timeout = service.waitForAuth("timeout", 1_000);
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(timeout).resolves.toEqual({
      success: false,
      error: "Authorization timeout",
    });

    await expect(service.waitForAuth("missing")).resolves.toEqual({
      success: false,
      error: "No pending authorization found",
    });
  });

  it("exercises token preview, validity, removal, refreshability, and pending-auth utilities", () => {
    service.saveTokensForServer("short", token({ accessToken: "short" }));
    service.saveTokensForServer(
      "expired",
      token({ accessToken: "long-access-token", expiresAt: Date.now() - 1 })
    );
    service.saveTokensForServer("valid", token({ accessToken: "long-access-token" }));

    expect(service.getAllStoredTokenServerIds().sort()).toEqual(["expired", "short", "valid"]);
    expect(service.getTokenPreview("short")).toBe("****");
    expect(service.getTokenPreview("valid")).toBe("long...oken");
    expect(service.getTokenPreview("missing")).toBeNull();
    expect(service.hasValidToken("valid")).toBe(true);
    expect(service.hasValidToken("expired")).toBe(false);
    expect(service.isTokenExpired("expired")).toBe(true);
    expect(service.isRefreshable("expired")).toBe(true);
    expect(service.serverRequiresOAuth(remoteServer({ oauth: { enabled: true } }))).toBe(true);

    const internals = service as unknown as AuthServiceInternals;
    internals.pendingAuths.set("keep", pendingAuth({ serverId: "keep", createdAt: Date.now() }));
    internals.pendingAuths.set(
      "stale",
      pendingAuth({ serverId: "stale", createdAt: Date.now() - 10 * 60 * 1000 })
    );
    expect(service.getPendingAuthServers().sort()).toEqual(["keep", "stale"]);
    service.cleanupExpiredAuths();
    expect(service.getPendingAuthServers()).toEqual(["keep"]);
    service.cancelPendingAuth("keep");
    expect(service.getPendingAuthServers()).toEqual([]);

    service.removeToken("short");
    expect(service.getToken("short")).toBeNull();
    service.clearAllTokens();
    expect(service.getAllStoredTokenServerIds()).toEqual([]);
  });

  it("gets valid tokens directly or through refresh when close to expiry", async () => {
    const server = remoteServer();

    await expect(service.getValidToken(server)).resolves.toBeNull();

    service.saveTokensForServer("remote", token({ expiresAt: Date.now() + 60 * 60 * 1000 }));
    await expect(service.getValidToken(server)).resolves.toBe("access-token");

    service.saveTokensForServer(
      "remote",
      token({ accessToken: "old", expiresAt: Date.now() + 1_000 })
    );
    vi.spyOn(service, "refreshToken").mockResolvedValueOnce(token({ accessToken: "fresh" }));
    await expect(service.getValidToken(server)).resolves.toBe("fresh");

    service.saveTokensForServer(
      "remote",
      token({ accessToken: "old", refreshToken: undefined, expiresAt: Date.now() + 1_000 })
    );
    await expect(service.getValidToken(server)).resolves.toBeNull();
  });

  it("handles refresh-token failure paths and request construction", async () => {
    const server = remoteServer({
      oauth: {
        enabled: true,
        clientId: "server-client",
        clientSecret: "server-secret",
      },
    });

    await expect(
      service.refreshToken(server, token({ refreshToken: undefined }))
    ).resolves.toBeNull();

    vi.spyOn(service, "discoverAuthServer").mockResolvedValueOnce(null);
    await expect(service.refreshToken(server, token())).resolves.toBeNull();

    vi.spyOn(service, "discoverAuthServer").mockResolvedValue({
      metadata: AUTH_METADATA,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("bad", { status: 400 })));
    await expect(service.refreshToken(server, token())).resolves.toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("network")));
    await expect(service.refreshToken(server, token())).resolves.toBeNull();

    const fetchMock = vi.fn().mockResolvedValueOnce(
      responseJson({
        access_token: "refreshed",
        token_type: "Bearer",
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      service.refreshToken(
        server,
        token({ clientId: "stored-client", clientSecret: "stored-secret", scopes: ["old"] })
      )
    ).resolves.toMatchObject({
      accessToken: "refreshed",
      refreshToken: "refresh-token",
      clientId: "server-client",
      clientSecret: "server-secret",
      scopes: ["old"],
    });
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("client_id=server-client");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("client_secret=server-secret");
  });

  it("deduplicates refreshes with a per-server mutex", async () => {
    let resolveRefresh: (value: StoredOAuthTokens | null) => void = () => undefined;
    const refreshPromise = new Promise<StoredOAuthTokens | null>((resolve) => {
      resolveRefresh = resolve;
    });
    const refreshSpy = vi.spyOn(service, "refreshToken").mockReturnValue(refreshPromise);
    const server = remoteServer();
    const stored = token();

    const first = service.refreshTokenWithMutex(server, stored);
    const second = service.refreshTokenWithMutex(server, stored);
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    resolveRefresh(token({ accessToken: "deduped" }));
    await expect(first).resolves.toMatchObject({ accessToken: "deduped" });
    await expect(second).resolves.toMatchObject({ accessToken: "deduped" });
  });

  it("ensures tokens are valid or refreshable", async () => {
    const server = remoteServer();

    await expect(service.ensureValidToken(server)).resolves.toBe(false);

    service.saveTokensForServer("remote", token({ accessToken: "valid" }));
    await expect(service.ensureValidToken(server)).resolves.toBe(true);

    service.saveTokensForServer(
      "remote",
      token({ accessToken: "", refreshToken: "refresh", expiresAt: Date.now() - 1 })
    );
    vi.spyOn(service, "refreshTokenWithMutex").mockResolvedValueOnce(
      token({ accessToken: "fresh" })
    );
    await expect(service.ensureValidToken(server)).resolves.toBe(true);

    vi.spyOn(service, "refreshTokenWithMutex").mockResolvedValueOnce(null);
    await expect(service.ensureValidToken(server)).resolves.toBe(false);
  });

  it("schedules, retries, and stops proactive refresh timers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const server = remoteServer();
    const onRefreshed = vi.fn();

    service.saveTokensForServer("remote", token({ expiresAt: Date.now() + 11 * 60 * 1000 }));
    vi.spyOn(service, "refreshTokenWithMutex").mockResolvedValueOnce(
      token({ accessToken: "fresh", expiresAt: Date.now() + 60 * 60 * 1000 })
    );

    service.startProactiveRefresh([server], onRefreshed);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(onRefreshed).toHaveBeenCalledWith("remote");

    service.saveTokensForServer(
      "remote",
      token({ accessToken: "old", expiresAt: Date.now() + 11 * 60 * 1000 })
    );
    vi.spyOn(service, "refreshTokenWithMutex").mockResolvedValueOnce(null);
    service.scheduleRefreshForServer(server);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect((service as unknown as AuthServiceInternals).refreshRetryCounts.get("remote")).toBe(1);

    service.stopProactiveRefresh();
    expect((service as unknown as AuthServiceInternals).refreshRetryCounts.size).toBe(0);
  });

  it("processes callback server routes and exchanges authorization codes", async () => {
    const redirectUri = await service.startCallbackServer();
    const baseUrl = redirectUri.replace("/callback", "");

    await expect(requestText(`${baseUrl}/favicon.ico`)).resolves.toMatchObject({ status: 404 });
    await expect(requestText(`${redirectUri}?state=missing-code`)).resolves.toMatchObject({
      status: 400,
    });

    const internals = service as unknown as AuthServiceInternals;
    internals.pendingAuths.set("error-state", pendingAuth({ state: "error-state" }));
    await expect(
      requestText(`${redirectUri}?error=access_denied&error_description=Nope&state=error-state`)
    ).resolves.toMatchObject({ status: 400 });
    expect(service.getPendingAuthState("remote")).toBeNull();

    internals.pendingAuths.set("state", pendingAuth({ redirectUri }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        responseJson({
          access_token: "callback-access",
          refresh_token: "callback-refresh",
          token_type: "Bearer",
          expires_in: 30,
          scope: "tools.read tools.write",
        })
      )
    );

    await expect(requestText(`${redirectUri}?code=code&state=state`)).resolves.toMatchObject({
      status: 200,
    });
    expect(service.getToken("remote")).toMatchObject({
      accessToken: "callback-access",
      refreshToken: "callback-refresh",
      scopes: ["tools.read", "tools.write"],
      clientId: "client",
      clientSecret: "secret",
    });
    expect(service.getPendingAuthState("remote")).toBeNull();
  });
});
