import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransportAuthProvider } from "../src/services/oauth-transport.provider.js";
import type AuthService from "../src/services/auth.service.js";
import type { RemoteServer, StoredOAuthTokens } from "../src/types/index.js";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const NOW = 1_700_000_000_000;

interface FakeAuthHarness {
  authService: AuthService;
  getToken: ReturnType<typeof vi.fn>;
  saveTokensForServer: ReturnType<typeof vi.fn>;
  removeToken: ReturnType<typeof vi.fn>;
  refreshTokenWithMutex: ReturnType<typeof vi.fn>;
  currentToken: () => StoredOAuthTokens | undefined;
}

function createServer(overrides: Partial<RemoteServer> = {}): RemoteServer {
  return {
    id: "remote",
    name: "Remote Server",
    type: "http",
    url: "https://example.test/mcp",
    ...overrides,
  };
}

function createAuthHarness(initialToken?: StoredOAuthTokens): FakeAuthHarness {
  let token = initialToken;
  const getToken = vi.fn(() => token);
  const saveTokensForServer = vi.fn((_serverId: string, nextToken: StoredOAuthTokens) => {
    token = nextToken;
  });
  const removeToken = vi.fn(() => {
    token = undefined;
  });
  const refreshTokenWithMutex = vi.fn();

  return {
    authService: {
      getToken,
      saveTokensForServer,
      removeToken,
      refreshTokenWithMutex,
    } as unknown as AuthService,
    getToken,
    saveTokensForServer,
    removeToken,
    refreshTokenWithMutex,
    currentToken: () => token,
  };
}

describe("createTransportAuthProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes OAuth client metadata from the server config", () => {
    const server = createServer({
      oauth: {
        enabled: true,
        scopes: ["tools:read", "tools:write"],
      },
    });
    const { authService } = createAuthHarness();

    const provider = createTransportAuthProvider(server, authService);

    expect(provider.redirectUrl.toString()).toBe("http://127.0.0.1:8400/callback");
    expect(provider.clientMetadata).toMatchObject({
      client_name: "MCP Server Manager",
      software_id: "mcp-server-manager",
      scope: "tools:read tools:write",
    });
  });

  it("uses server OAuth client credentials before stored token credentials", async () => {
    const server = createServer({
      oauth: {
        enabled: true,
        clientId: "server-client",
        clientSecret: "server-secret",
      },
    });
    const { authService } = createAuthHarness({
      accessToken: "access",
      tokenType: "Bearer",
      clientId: "stored-client",
      clientSecret: "stored-secret",
    });

    const provider = createTransportAuthProvider(server, authService);

    await expect(provider.clientInformation()).resolves.toEqual({
      client_id: "server-client",
      client_secret: "server-secret",
    });
  });

  it("falls back from stored OAuth client credentials to the server URL", async () => {
    const server = createServer();
    const storedAuth = createAuthHarness({
      accessToken: "access",
      tokenType: "Bearer",
      clientId: "stored-client",
      clientSecret: "stored-secret",
    });
    const storedProvider = createTransportAuthProvider(server, storedAuth.authService);

    await expect(storedProvider.clientInformation()).resolves.toEqual({
      client_id: "stored-client",
      client_secret: "stored-secret",
    });

    const emptyAuth = createAuthHarness();
    const fallbackProvider = createTransportAuthProvider(server, emptyAuth.authService);
    await expect(fallbackProvider.clientInformation()).resolves.toEqual({
      client_id: "https://example.test/mcp",
    });
  });

  it("returns undefined when no token is stored", async () => {
    const { authService } = createAuthHarness();
    const provider = createTransportAuthProvider(createServer(), authService);

    await expect(provider.tokens()).resolves.toBeUndefined();
  });

  it("maps stored tokens to SDK OAuth tokens with remaining expiry seconds", async () => {
    const token: StoredOAuthTokens = {
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      scopes: ["tools", "profile"],
      expiresAt: NOW + 600_500,
    };
    const { authService } = createAuthHarness(token);
    const provider = createTransportAuthProvider(createServer(), authService);

    await expect(provider.tokens()).resolves.toEqual({
      access_token: "access",
      refresh_token: "refresh",
      token_type: "Bearer",
      scope: "tools profile",
      expires_in: 600,
    });
  });

  it("refreshes expiring tokens before returning them", async () => {
    const stored: StoredOAuthTokens = {
      accessToken: "old-access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: NOW + 1_000,
    };
    const refreshed: StoredOAuthTokens = {
      accessToken: "new-access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: NOW + 120_000,
    };
    const server = createServer();
    const harness = createAuthHarness(stored);
    harness.refreshTokenWithMutex.mockResolvedValue(refreshed);

    const provider = createTransportAuthProvider(server, harness.authService);

    await expect(provider.tokens()).resolves.toMatchObject({
      access_token: "new-access",
      refresh_token: "refresh",
      expires_in: 120,
    });
    expect(harness.refreshTokenWithMutex).toHaveBeenCalledWith(server, stored);
  });

  it("keeps a still-valid token when refresh fails and drops an expired token", async () => {
    const stillValid: StoredOAuthTokens = {
      accessToken: "old-access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: NOW + 1_000,
    };
    const validHarness = createAuthHarness(stillValid);
    validHarness.refreshTokenWithMutex.mockResolvedValue(undefined);
    const validProvider = createTransportAuthProvider(createServer(), validHarness.authService);

    await expect(validProvider.tokens()).resolves.toMatchObject({
      access_token: "old-access",
    });

    const expired: StoredOAuthTokens = {
      ...stillValid,
      expiresAt: NOW - 1,
    };
    const expiredHarness = createAuthHarness(expired);
    expiredHarness.refreshTokenWithMutex.mockResolvedValue(undefined);
    const expiredProvider = createTransportAuthProvider(createServer(), expiredHarness.authService);

    await expect(expiredProvider.tokens()).resolves.toBeUndefined();
  });

  it("merges newly saved tokens with stored refresh token and client credentials", async () => {
    const existing: StoredOAuthTokens = {
      accessToken: "old",
      refreshToken: "keep-refresh",
      tokenType: "Bearer",
      scopes: ["old-scope"],
      clientId: "client-id",
      clientSecret: "client-secret",
    };
    const harness = createAuthHarness(existing);
    const provider = createTransportAuthProvider(createServer(), harness.authService);
    const oauthTokens: OAuthTokens = {
      access_token: "new",
      token_type: "Bearer",
      scope: "new-scope extra",
      expires_in: 30,
    };

    await provider.saveTokens(oauthTokens);

    expect(harness.saveTokensForServer).toHaveBeenCalledWith("remote", {
      accessToken: "new",
      refreshToken: "keep-refresh",
      tokenType: "Bearer",
      scopes: ["new-scope", "extra"],
      expiresAt: NOW + 30_000,
      clientId: "client-id",
      clientSecret: "client-secret",
    });
    expect(harness.currentToken()?.accessToken).toBe("new");
  });

  it("throws a reauthentication error instead of opening an authorization URL", async () => {
    const provider = createTransportAuthProvider(createServer(), createAuthHarness().authService);

    await expect(provider.redirectToAuthorization(new URL("https://auth.test"))).rejects.toThrow(
      "Authorization required for Remote Server"
    );
  });

  it("stores and clears the PKCE verifier independently of generated state", async () => {
    const provider = createTransportAuthProvider(createServer(), createAuthHarness().authService);

    await provider.saveCodeVerifier("verifier");
    await expect(provider.codeVerifier()).resolves.toBe("verifier");
    await expect(provider.state()).resolves.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    await provider.invalidateCredentials("verifier");
    await expect(provider.codeVerifier()).resolves.toBe("");
  });

  it("invalidates access tokens while preserving refresh tokens", async () => {
    const token: StoredOAuthTokens = {
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: NOW + 60_000,
    };
    const harness = createAuthHarness(token);
    const provider = createTransportAuthProvider(createServer(), harness.authService);

    await provider.invalidateCredentials("tokens");

    expect(harness.removeToken).not.toHaveBeenCalled();
    expect(harness.currentToken()).toEqual({
      ...token,
      accessToken: "",
      expiresAt: 0,
    });
  });

  it("removes token records with no refresh token and can clear client credentials", async () => {
    const noRefresh = createAuthHarness({
      accessToken: "access",
      tokenType: "Bearer",
      clientId: "client",
      clientSecret: "secret",
    });
    const removingProvider = createTransportAuthProvider(createServer(), noRefresh.authService);

    await removingProvider.invalidateCredentials("tokens");
    expect(noRefresh.removeToken).toHaveBeenCalledWith("remote");
    expect(noRefresh.currentToken()).toBeUndefined();

    const withClient = createAuthHarness({
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      clientId: "client",
      clientSecret: "secret",
    });
    const clientProvider = createTransportAuthProvider(createServer(), withClient.authService);

    await clientProvider.invalidateCredentials("client");
    expect(withClient.currentToken()).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
    });
  });
});
