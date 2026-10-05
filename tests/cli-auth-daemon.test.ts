import { describe, it, expect, beforeEach, vi } from "vitest";
import { Command } from "commander";
import { registerAuthCommands } from "../src/cli/commands/auth.cmd.js";
import { registerDaemonCommands } from "../src/cli/commands/daemon.cmd.js";

const mockConfigService = {
  getRemoteServers: vi.fn(() => []),
  findServer: vi.fn(),
  findLocalServer: vi.fn(),
  findRemoteServer: vi.fn(),
};

const mockAuthService = {
  hasValidToken: vi.fn(() => false),
  isTokenExpired: vi.fn(() => false),
  isRefreshable: vi.fn(() => false),
  ensureValidToken: vi.fn(() => Promise.resolve(false)),
  getToken: vi.fn(),
  getTokenPreview: vi.fn(),
  getValidToken: vi.fn(() => Promise.resolve("refreshed-token")),
  startOAuthFlow: vi.fn(),
  waitForAuth: vi.fn(),
  stopCallbackServer: vi.fn(),
  refreshToken: vi.fn(),
  removeToken: vi.fn(),
  clearAllTokens: vi.fn(),
  getAllStoredTokenServerIds: vi.fn(() => []),
};

const mockTestingService = {
  testRemoteServer: vi.fn(),
};

const mockDaemonService = {
  startDaemon: vi.fn(),
  stopDaemon: vi.fn(),
  refreshDaemon: vi.fn(),
  getStatus: vi.fn(() => ({
    running: false,
    pid: null,
    port: 8850,
    startupEnabled: false,
    logFile: "/tmp/daemon.log",
  })),
  getLogFilePath: vi.fn(() => "/tmp/daemon.log"),
  getLogs: vi.fn(() => ["line 1", "line 2"]),
  clearLogs: vi.fn(),
  enableStartup: vi.fn(() => ({ success: true })),
  disableStartup: vi.fn(() => ({ success: true })),
  isStartupEnabled: vi.fn(() => false),
  getPlatformInfo: vi.fn(() => ({ supported: true, platform: "darwin", type: "launchd" })),
};

const mockProfileService = {
  getProfile: vi.fn(),
};

const mockGateway = {
  runGatewayForeground: vi.fn(async () => {}),
};

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof mockConfigService => mockConfigService,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: (): typeof mockAuthService => mockAuthService,
}));

vi.mock("../src/services/testing.service.js", () => ({
  getTestingService: (): typeof mockTestingService => mockTestingService,
}));

vi.mock("../src/services/daemon.service.js", () => ({
  getDaemonService: (): typeof mockDaemonService => mockDaemonService,
}));

vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: (): typeof mockProfileService => mockProfileService,
}));

vi.mock("../src/services/gateway.service.js", () => ({
  runGatewayForeground: mockGateway.runGatewayForeground,
}));

describe("CLI auth/daemon commands", () => {
  const remoteServer = {
    id: "remote1",
    name: "Remote One",
    url: "https://api.example.com",
    type: "http" as const,
    oauth: { enabled: true },
  };
  const localServer = { id: "local1", name: "Local One", command: "node", args: [] };

  const buildAuthProgram = (): Command => {
    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);
    return program;
  };

  const buildDaemonProgram = (): Command => {
    const program = new Command();
    program.exitOverride();
    registerDaemonCommands(program);
    return program;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService.getRemoteServers.mockReturnValue([remoteServer]);
    mockConfigService.findServer.mockImplementation((id: string) => {
      if (id === remoteServer.id || id === remoteServer.name) {
        return { server: remoteServer, type: "remote" as const };
      }
      if (id === localServer.id || id === localServer.name) {
        return { server: localServer, type: "local" as const };
      }
      return null;
    });
    mockConfigService.findRemoteServer.mockReturnValue(remoteServer);
    mockConfigService.findLocalServer.mockReturnValue(localServer);

    mockAuthService.getToken.mockReturnValue({ accessToken: "tok", refreshToken: "refresh" });
    mockAuthService.startOAuthFlow.mockResolvedValue({ authUrl: "https://auth", state: "state1" });
    mockAuthService.waitForAuth.mockResolvedValue({ success: true });
    mockAuthService.ensureValidToken.mockResolvedValue(false);
    mockAuthService.refreshToken.mockResolvedValue({ accessToken: "new", tokenType: "Bearer" });
    mockTestingService.testRemoteServer.mockResolvedValue({ success: true, toolCount: 2 });
    mockDaemonService.startDaemon.mockResolvedValue({ success: true, pid: 999 });
    mockDaemonService.refreshDaemon.mockResolvedValue({ success: true });
    mockDaemonService.stopDaemon.mockResolvedValue({ success: true });
    mockDaemonService.getStatus.mockResolvedValue({
      running: false,
      pid: null,
      port: 8850,
      startupEnabled: false,
      logFile: "/tmp/daemon.log",
      healthy: false,
    });
    mockDaemonService.getLogs.mockReturnValue(["line 1", "line 2"]);
    mockDaemonService.getPlatformInfo.mockReturnValue({
      supported: true,
      platform: "darwin",
      type: "launchd",
    });
    mockDaemonService.isStartupEnabled.mockReturnValue(false);
  });

  const expectProcessExit = async (action: () => Promise<unknown>): Promise<void> => {
    const exit = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? ""}`);
    });
    await expect(action()).rejects.toThrow("process.exit:1");
    exit.mockRestore();
  };

  it("runs auth login without opening a browser", async () => {
    const program = buildAuthProgram();

    await program.parseAsync(["node", "test", "auth", "login", remoteServer.id, "--no-browser"]);

    expect(mockAuthService.startOAuthFlow).toHaveBeenCalledWith(remoteServer);
    expect(mockAuthService.waitForAuth).toHaveBeenCalledWith("state1");
    expect(mockTestingService.testRemoteServer).toHaveBeenCalled();
  });

  it("logs out, refreshes, and handles login-all", async () => {
    const program = buildAuthProgram();

    mockAuthService.hasValidToken.mockReturnValue(true);
    await program.parseAsync(["node", "test", "auth", "logout", remoteServer.id, "--force"]);
    expect(mockAuthService.removeToken).toHaveBeenCalledWith(remoteServer.id);

    mockAuthService.getToken.mockReturnValue({ accessToken: "tok", refreshToken: "refresh" });
    await program.parseAsync(["node", "test", "auth", "refresh", remoteServer.id]);
    expect(mockAuthService.refreshToken).toHaveBeenCalled();

    mockAuthService.hasValidToken.mockReturnValue(false);
    mockAuthService.startOAuthFlow.mockResolvedValue({ authUrl: "https://auth", state: "state2" });
    await program.parseAsync(["node", "test", "auth", "login-all", "--no-browser"]);
    expect(mockAuthService.startOAuthFlow).toHaveBeenCalledWith(remoteServer);
    expect(mockAuthService.waitForAuth).toHaveBeenCalledWith("state2");
  });

  it("starts daemon with servers, profile, and foreground modes", async () => {
    const program = buildDaemonProgram();

    await program.parseAsync(["node", "test", "daemon", "start", localServer.id, remoteServer.id]);
    expect(mockDaemonService.startDaemon).toHaveBeenCalled();

    mockDaemonService.startDaemon.mockClear();
    mockProfileService.getProfile.mockReturnValue({
      servers: [localServer.id],
      remoteServers: [],
    });
    await program.parseAsync(["node", "test", "daemon", "start", "--profile", "dev"]);
    expect(mockDaemonService.startDaemon).toHaveBeenCalled();

    await program.parseAsync(["node", "test", "daemon", "start", "--foreground"]);
    expect(mockGateway.runGatewayForeground).toHaveBeenCalled();
  });

  it("refreshes daemon and clears logs", async () => {
    const program = buildDaemonProgram();

    await program.parseAsync(["node", "test", "daemon", "refresh"]);
    expect(mockDaemonService.refreshDaemon).toHaveBeenCalled();

    await program.parseAsync(["node", "test", "daemon", "logs", "--clear"]);
    expect(mockDaemonService.clearLogs).toHaveBeenCalled();
  });

  it("reports auth status in text and JSON modes", async () => {
    const program = buildAuthProgram();

    mockAuthService.hasValidToken.mockReturnValue(false);
    mockAuthService.isTokenExpired.mockReturnValue(true);
    mockAuthService.isRefreshable.mockReturnValue(true);
    mockAuthService.ensureValidToken.mockResolvedValue(true);
    mockAuthService.getToken.mockReturnValue({
      accessToken: "tok",
      tokenType: "Bearer",
      expiresAt: Date.now() + 30 * 60 * 1000,
    });
    mockAuthService.getTokenPreview.mockReturnValue("tok...view");

    await program.parseAsync(["node", "test", "auth", "status"]);
    expect(mockAuthService.ensureValidToken).toHaveBeenCalledWith(remoteServer);

    await program.parseAsync(["node", "test", "auth", "status", "--json"]);

    mockConfigService.getRemoteServers.mockReturnValue([]);
    await program.parseAsync(["node", "test", "auth", "status"]);
  });

  it("handles auth login short-circuit and failure branches", async () => {
    const program = buildAuthProgram();

    mockAuthService.hasValidToken.mockReturnValue(true);
    await program.parseAsync(["node", "test", "auth", "login", remoteServer.id, "--no-browser"]);
    expect(mockAuthService.startOAuthFlow).not.toHaveBeenCalled();

    mockAuthService.hasValidToken.mockReturnValue(false);
    mockAuthService.isRefreshable.mockReturnValue(true);
    mockAuthService.ensureValidToken.mockResolvedValueOnce(true);
    await program.parseAsync(["node", "test", "auth", "login", remoteServer.id, "--no-browser"]);

    mockAuthService.ensureValidToken.mockResolvedValueOnce(false);
    mockAuthService.startOAuthFlow.mockResolvedValueOnce(null);
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "login", remoteServer.id, "--no-browser"])
    );

    mockConfigService.findServer.mockReturnValueOnce({ server: localServer, type: "local" });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "login", localServer.id, "--no-browser"])
    );

    mockConfigService.findServer.mockReturnValueOnce({
      server: { ...remoteServer, oauth: { enabled: false } },
      type: "remote",
    });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "login", remoteServer.id, "--no-browser"])
    );

    mockAuthService.startOAuthFlow.mockResolvedValueOnce({
      authUrl: "https://auth",
      state: "failed",
    });
    mockAuthService.waitForAuth.mockResolvedValueOnce({ success: false, error: "denied" });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "login", remoteServer.id, "--no-browser"])
    );
  });

  it("handles auth logout, login-all, and refresh edge cases", async () => {
    const program = buildAuthProgram();

    mockAuthService.hasValidToken.mockReturnValue(false);
    await program.parseAsync(["node", "test", "auth", "logout", remoteServer.id, "--force"]);
    expect(mockAuthService.removeToken).not.toHaveBeenCalled();

    mockConfigService.getRemoteServers.mockReturnValueOnce([]);
    await program.parseAsync(["node", "test", "auth", "login-all", "--no-browser"]);

    mockConfigService.getRemoteServers.mockReturnValueOnce([remoteServer]);
    mockAuthService.hasValidToken.mockReturnValueOnce(true);
    await program.parseAsync(["node", "test", "auth", "login-all", "--no-browser"]);

    mockConfigService.getRemoteServers.mockReturnValueOnce([remoteServer]);
    mockAuthService.hasValidToken.mockReturnValue(false);
    mockAuthService.startOAuthFlow.mockResolvedValueOnce(null);
    await program.parseAsync(["node", "test", "auth", "login-all", "--no-browser"]);

    mockConfigService.getRemoteServers.mockReturnValueOnce([remoteServer]);
    mockAuthService.startOAuthFlow.mockResolvedValueOnce({
      authUrl: "https://auth",
      state: "bad-state",
    });
    mockAuthService.waitForAuth.mockResolvedValueOnce({ success: false, error: "denied" });
    await program.parseAsync(["node", "test", "auth", "login-all", "--no-browser"]);

    mockAuthService.getToken.mockReturnValueOnce(null);
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "refresh", remoteServer.id])
    );

    mockAuthService.getToken.mockReturnValueOnce({ accessToken: "tok", tokenType: "Bearer" });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "refresh", remoteServer.id])
    );

    mockAuthService.getToken.mockReturnValueOnce({
      accessToken: "tok",
      refreshToken: "refresh",
      tokenType: "Bearer",
    });
    mockAuthService.refreshToken.mockResolvedValueOnce(null);
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "auth", "refresh", remoteServer.id])
    );
  });

  it("reports daemon status, logs, and stop failures", async () => {
    const program = buildDaemonProgram();

    mockDaemonService.getStatus.mockResolvedValueOnce({
      running: true,
      pid: 123,
      port: 8850,
      startupEnabled: true,
      logFile: "/tmp/daemon.log",
      healthy: true,
      health: { servers: 2, tools: 5 },
    });
    await program.parseAsync(["node", "test", "daemon", "status"]);

    mockDaemonService.getStatus.mockResolvedValueOnce({
      running: true,
      pid: 123,
      port: 8850,
      startupEnabled: false,
      logFile: "/tmp/daemon.log",
      healthy: false,
      health: { error: "not responding" },
    });
    await program.parseAsync(["node", "test", "daemon", "status"]);

    await program.parseAsync(["node", "test", "daemon", "status", "--json"]);

    mockDaemonService.getLogs.mockReturnValueOnce([]);
    await program.parseAsync(["node", "test", "daemon", "logs"]);

    mockDaemonService.getLogs.mockReturnValueOnce(["line 1", "line 2"]);
    await program.parseAsync(["node", "test", "daemon", "logs", "--lines", "2"]);

    mockDaemonService.stopDaemon.mockResolvedValueOnce({ success: false, error: "not running" });
    await expectProcessExit(() => program.parseAsync(["node", "test", "daemon", "stop"]));

    mockDaemonService.refreshDaemon.mockResolvedValueOnce({ success: false, error: "offline" });
    await expectProcessExit(() => program.parseAsync(["node", "test", "daemon", "refresh"]));
  });

  it("handles daemon start validation and daemon start failures", async () => {
    const program = buildDaemonProgram();

    mockConfigService.findServer.mockReturnValueOnce(null);
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "daemon", "start", "missing"])
    );

    mockProfileService.getProfile.mockReturnValueOnce(null);
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "daemon", "start", "--profile", "missing"])
    );

    mockProfileService.getProfile.mockReturnValueOnce({ servers: [], remoteServers: ["r1"] });
    mockDaemonService.startDaemon.mockResolvedValueOnce({ success: false, error: "boom" });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "daemon", "start", "--profile", "empty-local"])
    );
  });

  it("manages daemon startup settings", async () => {
    const program = buildDaemonProgram();

    await program.parseAsync(["node", "test", "daemon", "startup"]);
    await program.parseAsync(["node", "test", "daemon", "startup", "status"]);

    await program.parseAsync(["node", "test", "daemon", "startup", "enable"]);
    expect(mockDaemonService.enableStartup).toHaveBeenCalled();

    await program.parseAsync(["node", "test", "daemon", "startup", "disable"]);
    expect(mockDaemonService.disableStartup).toHaveBeenCalled();

    mockDaemonService.getPlatformInfo.mockReturnValueOnce({
      supported: false,
      platform: "freebsd",
      type: "unknown",
    });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "daemon", "startup", "enable"])
    );

    mockDaemonService.enableStartup.mockReturnValueOnce({ success: false, error: "denied" });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "daemon", "startup", "enable"])
    );

    mockDaemonService.disableStartup.mockReturnValueOnce({ success: false, error: "denied" });
    await expectProcessExit(() =>
      program.parseAsync(["node", "test", "daemon", "startup", "disable"])
    );
  });
});
