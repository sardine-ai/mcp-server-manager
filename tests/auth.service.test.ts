import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { AuthService, resetAuthService } from "../src/services/auth.service.js";
import type { PendingAuthorization, RemoteServer, StoredOAuthTokens } from "../src/types/index.js";

const fileMode = (filePath: string): number => fs.statSync(filePath).mode & 0o777;

type AuthServiceWithPendingInternals = AuthService & {
  pendingAuths: Map<string, PendingAuthorization>;
  savePendingAuths: () => void;
};

describe("AuthService", () => {
  let configDir: string;
  let service: AuthService;
  let originalMcpManagerConfigDir: string | undefined;
  let originalMcpsmConfigDir: string | undefined;

  beforeEach(() => {
    originalMcpManagerConfigDir = process.env.MCP_MANAGER_CONFIG_DIR;
    originalMcpsmConfigDir = process.env.MCPSM_CONFIG_DIR;
    delete process.env.MCP_MANAGER_CONFIG_DIR;
    delete process.env.MCPSM_CONFIG_DIR;
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-auth-"));
    service = new AuthService(configDir);
  });

  afterEach(() => {
    resetAuthService();
    vi.unstubAllGlobals();
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
    if (originalMcpManagerConfigDir === undefined) {
      delete process.env.MCP_MANAGER_CONFIG_DIR;
    } else {
      process.env.MCP_MANAGER_CONFIG_DIR = originalMcpManagerConfigDir;
    }
    if (originalMcpsmConfigDir === undefined) {
      delete process.env.MCPSM_CONFIG_DIR;
    } else {
      process.env.MCPSM_CONFIG_DIR = originalMcpsmConfigDir;
    }
  });

  it("parses WWW-Authenticate headers for auth requirements", () => {
    const header =
      'Bearer realm="example", resource_metadata="https://auth/meta", scope="tools.read", error="invalid_token", error_description="login required"';

    const parsed = service.parseWWWAuthenticate(header);

    expect(parsed.realm).toBe("example");
    expect(parsed.resourceMetadataUrl).toContain("https://auth/meta");
    expect(parsed.scope).toBe("tools.read");
    expect(parsed.error).toBe("invalid_token");
    expect(parsed.errorDescription).toContain("login");
  });

  it("persists tokens and reports validity/preview", () => {
    const expiresAt = Date.now() + 60_000;
    service.saveTokensForServer("srv", {
      accessToken: "token-value",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      expiresAt,
    });

    const reloaded = new AuthService(configDir);
    expect(reloaded.hasValidToken("srv")).toBe(true);
    expect(reloaded.getTokenPreview("srv")).toBe("toke...alue");
    expect(reloaded.getToken("srv")?.refreshToken).toBe("refresh-token");
    expect(reloaded.isTokenExpired("srv")).toBe(false);
  });

  it("stores OAuth tokens and pending auth state with private permissions", async () => {
    if (process.platform === "win32") return;

    service.saveTokensForServer("srv", {
      accessToken: "token-value",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
    });
    const internals = service as unknown as AuthServiceWithPendingInternals;
    internals.pendingAuths.set("state", {
      serverId: "remote1",
      serverUrl: "https://api.example.com",
      pkce: {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
      },
      state: "state",
      redirectUri: "http://127.0.0.1:8400/callback",
      authorizationEndpoint: "https://auth.example.com/authorize",
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "client",
      scopes: ["tools.read"],
      createdAt: Date.now(),
    });
    internals.savePendingAuths();

    const paths = service.getStoragePaths();
    expect(fileMode(paths.configDir)).toBe(0o700);
    expect(fileMode(paths.tokensPath)).toBe(0o600);
    expect(fileMode(paths.pendingAuthPath)).toBe(0o600);
  });

  it("uses MCP_MANAGER_CONFIG_DIR for default OAuth token storage", () => {
    const envConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-auth-env-"));
    try {
      resetAuthService();
      process.env.MCP_MANAGER_CONFIG_DIR = envConfigDir;

      const envService = new AuthService();

      expect(envService.getStoragePaths().tokensPath).toBe(
        path.join(envConfigDir, "oauth-tokens.json")
      );
    } finally {
      fs.rmSync(envConfigDir, { recursive: true, force: true });
    }
  });

  it("migrates legacy OAuth tokens into the main config directory", () => {
    if (process.platform === "win32") return;

    const mainConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-auth-main-"));
    const legacyConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-auth-legacy-"));
    const legacyTokensPath = path.join(legacyConfigDir, "oauth-tokens.json");
    const legacyTokens = {
      srv: {
        accessToken: "legacy-token",
        refreshToken: "legacy-refresh",
        tokenType: "Bearer",
      },
    };

    try {
      fs.writeFileSync(legacyTokensPath, JSON.stringify(legacyTokens), { mode: 0o644 });
      fs.chmodSync(legacyConfigDir, 0o755);
      fs.chmodSync(legacyTokensPath, 0o644);

      resetAuthService();
      process.env.MCP_MANAGER_CONFIG_DIR = mainConfigDir;
      process.env.MCPSM_CONFIG_DIR = legacyConfigDir;

      const migrated = new AuthService();
      const paths = migrated.getStoragePaths();

      expect(paths.tokensPath).toBe(path.join(mainConfigDir, "oauth-tokens.json"));
      expect(migrated.getToken("srv")?.accessToken).toBe("legacy-token");
      expect(JSON.parse(fs.readFileSync(paths.tokensPath, "utf8"))).toEqual(legacyTokens);
      expect(fileMode(paths.tokensPath)).toBe(0o600);
      expect(fileMode(legacyConfigDir)).toBe(0o700);
      expect(fileMode(legacyTokensPath)).toBe(0o600);
    } finally {
      fs.rmSync(mainConfigDir, { recursive: true, force: true });
      fs.rmSync(legacyConfigDir, { recursive: true, force: true });
    }
  });

  it("migrates default legacy OAuth tokens into the default main config directory", () => {
    if (process.platform === "win32") return;

    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-auth-home-"));
    const mainConfigDir = path.join(homeDir, ".mcp-manager");
    const legacyConfigDir = path.join(homeDir, ".mcpsm");
    const legacyTokensPath = path.join(legacyConfigDir, "oauth-tokens.json");
    const originalHome = process.env.HOME;
    const legacyTokens = {
      srv: {
        accessToken: "default-legacy-token",
        tokenType: "Bearer",
      },
    };

    try {
      fs.mkdirSync(legacyConfigDir, { recursive: true, mode: 0o755 });
      fs.writeFileSync(legacyTokensPath, JSON.stringify(legacyTokens), { mode: 0o644 });
      fs.chmodSync(legacyConfigDir, 0o755);
      fs.chmodSync(legacyTokensPath, 0o644);
      resetAuthService();
      process.env.HOME = homeDir;
      delete process.env.MCP_MANAGER_CONFIG_DIR;
      delete process.env.MCPSM_CONFIG_DIR;

      const migrated = new AuthService();
      const paths = migrated.getStoragePaths();

      expect(paths.tokensPath).toBe(path.join(mainConfigDir, "oauth-tokens.json"));
      expect(migrated.getToken("srv")?.accessToken).toBe("default-legacy-token");
      expect(fileMode(mainConfigDir)).toBe(0o700);
      expect(fileMode(paths.tokensPath)).toBe(0o600);
      expect(fileMode(legacyConfigDir)).toBe(0o700);
      expect(fileMode(legacyTokensPath)).toBe(0o600);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("refreshes tokens using the refresh_token grant", async () => {
    const server: RemoteServer = {
      id: "remote1",
      name: "Remote",
      url: "https://api.example.com",
      type: "http",
      oauth: { enabled: true },
    };

    const stored: StoredOAuthTokens = {
      accessToken: "old-token",
      refreshToken: "old-refresh",
      tokenType: "Bearer",
    };

    // Stub discovery + fetch to avoid network calls
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: "new-token",
          refresh_token: "new-refresh",
          token_type: "Bearer",
          expires_in: 10,
          scope: "one two",
        }),
      })
    );
    // @ts-expect-error - override for testing
    service.discoverAuthServer = vi.fn().mockResolvedValue({
      metadata: { token_endpoint: "https://auth/token" },
    });

    const refreshed = await service.refreshToken(server, stored);

    expect(refreshed?.accessToken).toBe("new-token");
    expect(refreshed?.refreshToken).toBe("new-refresh");
    expect(service.getToken(server.id)?.accessToken).toBe("new-token");
    expect(vi.mocked(fetch)).toHaveBeenCalled();
  });
});
