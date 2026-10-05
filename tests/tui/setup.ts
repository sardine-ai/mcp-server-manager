/**
 * Shared TUI test setup and mocks
 */

import React from "react";
import { vi } from "vitest";
import { render as inkRender } from "ink-testing-library";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "../../src/tui/theme/ThemeContext.js";

// Create a fresh QueryClient for each test
const createTestQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });

// Mock config service
export const mockConfigService = {
  getLocalServers: vi.fn(() => []),
  getRemoteServers: vi.fn(() => []),
  getToolFilters: vi.fn(() => ({})),
  getSelectionState: vi.fn(() => ({ local: [], remote: [] })),
  saveSelectionState: vi.fn(),
  generateServerId: vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, "-")),
  addLocalServer: vi.fn(() => ({ success: true })),
  addRemoteServer: vi.fn(() => ({ success: true })),
  removeLocalServer: vi.fn(() => ({ success: true })),
  removeRemoteServer: vi.fn(() => ({ success: true })),
  updateLocalServer: vi.fn(() => ({ success: true })),
  updateRemoteServer: vi.fn(() => ({ success: true })),
  toggleTool: vi.fn(),
  enableAllTools: vi.fn(),
  disableAllTools: vi.fn(),
  resetToolFilters: vi.fn(() => ({ success: true })),
  getPort: vi.fn(() => 8850),
  getPaths: vi.fn(() => ({
    configDir: "/tmp/test",
    configPath: "/tmp/test/config.json",
  })),
};

// Mock testing service
export const mockTestingService = {
  testLocalServer: vi.fn(() => Promise.resolve({ success: true, toolCount: 5 })),
  testRemoteServer: vi.fn(() => Promise.resolve({ success: true, toolCount: 3 })),
  testAllServers: vi.fn(() => Promise.resolve([])),
  testAllServersStreaming: vi.fn(async (_onResult: (result: unknown) => void) => {
    // Simulate streaming by calling onResult for each result
    return Promise.resolve([]);
  }),
  autoTestUnknownServers: vi.fn(() => Promise.resolve()),
};

// Mock client service
export const mockClientService = {
  detectClients: vi.fn(() => [
    {
      id: "claude",
      name: "Claude Desktop",
      configPath: "/path/to/claude/config.json",
      installed: true,
      hasConfig: true,
      status: "connected" as const,
      serverCount: 2,
    },
    {
      id: "cursor",
      name: "Cursor",
      configPath: null,
      installed: true,
      hasConfig: false,
      status: "disconnected" as const,
      serverCount: 0,
    },
  ]),
  connectClient: vi.fn(() => ({ success: true })),
  disconnectClient: vi.fn(() => ({ success: true })),
  getConnectionStatus: vi.fn((_id: string) => "connected" as const),
  getClientName: vi.fn((_id: string) => "client"),
  getClientConfigPath: vi.fn(() => "/path/to/config"),
  isClientInstalled: vi.fn(() => true),
  getSupportedClients: vi.fn(() => ["claude", "cursor", "windsurf"]),
  clientExists: vi.fn(() => true),
  readClientConfig: vi.fn(() => null),
  writeClientConfig: vi.fn(() => true),
  openClientConfig: vi.fn(() => ({ success: true })),
  connectAllProfiles: vi.fn(() => ({ succeeded: ["default"], failed: [] })),
  disconnectAllProfiles: vi.fn(() => ({ succeeded: ["default"], failed: [] })),
};

// Mock profile service
export const mockProfileService = {
  list: vi.fn(() => [
    { id: "default", name: "Default", isActive: true, includesAll: true, serverCount: 0 },
    { id: "dev", name: "Development", isActive: false, includesAll: false, serverCount: 2 },
  ]),
  create: vi.fn(() => ({ success: true })),
  delete: vi.fn(() => ({ success: true })),
  use: vi.fn(() => ({ success: true })),
  getActiveProfileId: vi.fn(() => "default"),
  getProfile: vi.fn((id: string) => {
    if (id === "default") return { name: "Default", servers: [], remoteServers: [] };
    if (id === "dev") return { name: "Development", servers: ["s1", "s2"], remoteServers: [] };
    return null;
  }),
  addServer: vi.fn(() => ({ success: true })),
  removeServer: vi.fn(() => ({ success: true })),
  makeExplicit: vi.fn(),
  rename: vi.fn(() => ({ success: true })),
  clone: vi.fn(() => ({ success: true })),
  reload: vi.fn(),
  getServersForProfile: vi.fn(() => ({ servers: [], remoteServers: [] })),
};

// Mock settings service
export const mockSettings = {
  autoTest: true,
  theme: "default",
  logLevel: "info",
  port: 8850,
  editor: "vi",
  defaultProfile: "default",
};

export const mockSettingsService = {
  getAll: vi.fn(() => mockSettings),
  getKeys: vi.fn(() => Object.keys(mockSettings) as (keyof typeof mockSettings)[]),
  get: vi.fn((key: string) => mockSettings[key as keyof typeof mockSettings]),
  set: vi.fn(() => ({ success: true })),
  reset: vi.fn(),
  isDefault: vi.fn(() => true),
  getTheme: vi.fn(() => "default"),
  getInfo: vi.fn(() => ({
    autoTest: { description: "Auto test new servers", type: "boolean" },
    theme: { description: "UI theme", type: "string", options: ["default", "minimal", "colorful"] },
    logLevel: { description: "Log level", type: "string" },
    port: { description: "Gateway port", type: "number" },
    editor: { description: "Preferred editor", type: "string" },
    defaultProfile: { description: "Default profile", type: "string" },
  })),
  getOptions: vi.fn((key: string) => {
    if (key === "theme") return ["default", "minimal", "colorful"];
    if (key === "defaultProfile") return ["default", "dev"];
    return undefined;
  }),
};

// Mock daemon service
export const mockDaemonService = {
  getStatus: vi.fn(() =>
    Promise.resolve({
      running: false,
      pid: null,
      port: 8850,
      startupEnabled: false,
      logFile: "/tmp/daemon.log",
      healthy: false,
    })
  ),
  isDaemonRunning: vi.fn(() => ({ running: false, pid: null })),
  checkHealth: vi.fn(() => Promise.resolve({ status: "ok", servers: 0, tools: 0 })),
  refreshDaemon: vi.fn(() => Promise.resolve({ success: true })),
  startDaemon: vi.fn(() => ({ success: true, pid: 12345 })),
  stopDaemon: vi.fn(() => ({ success: true })),
  enableStartup: vi.fn(() => ({ success: true })),
  disableStartup: vi.fn(() => ({ success: true })),
  getLogFilePath: vi.fn(() => "/tmp/daemon.log"),
};

export const mockAuthService = {
  hasValidToken: vi.fn(() => false),
  isTokenExpired: vi.fn(() => false),
  isRefreshable: vi.fn(() => false),
  getTokenPreview: vi.fn(() => "tok_123"),
  getToken: vi.fn(() => ({ accessToken: "token", refreshToken: "refresh", tokenType: "Bearer" })),
  getValidToken: vi.fn(() => Promise.resolve("refreshed-token")),
  startOAuthFlow: vi.fn(() => Promise.resolve({ authUrl: "https://auth", state: "state1" })),
  waitForAuth: vi.fn(() => Promise.resolve({ success: true, expiresAt: Date.now() + 1000 })),
  stopCallbackServer: vi.fn(),
  removeToken: vi.fn(),
  getAllStoredTokenServerIds: vi.fn(() => []),
  clearAllTokens: vi.fn(),
  refreshToken: vi.fn(() => Promise.resolve({ accessToken: "token2", tokenType: "Bearer" })),
  cancelPendingAuth: vi.fn(),
};

// Mock import/export service
export const mockImportExportService = {
  importFromFile: vi.fn(() => ({
    success: true,
    servers: [{ id: "imported", name: "Imported Server", command: "node", args: [] }],
    format: "mcpsm",
  })),
  importFromClient: vi.fn(() => ({
    success: true,
    servers: [{ id: "from-client", name: "From Client", command: "node", args: [] }],
  })),
  mergeServers: vi.fn(() => ({ added: 1, updated: 0, skipped: 0 })),
  mergeServersWithDecisions: vi.fn(() => ({ added: 1, updated: 0, skipped: 0, merged: 0 })),
  detectConflicts: vi.fn(() => ({
    conflicts: [],
    noConflicts: [{ id: "from-client", name: "From Client", command: "node", args: [] }],
    totalConflicts: 0,
  })),
  exportToFile: vi.fn(() => ({ success: true })),
  export: vi.fn(() => ({ servers: [], remoteServers: [] })),
};

// Setup all mocks
export function setupMocks(): void {
  vi.mock("../../src/services/config.service.js", () => ({
    getConfigService: vi.fn(() => mockConfigService),
    ConfigService: vi.fn(() => mockConfigService),
    resetConfigService: vi.fn(),
  }));

  vi.mock("../../src/services/testing.service.js", () => ({
    getTestingService: vi.fn(() => mockTestingService),
    TestingService: vi.fn(() => mockTestingService),
    resetTestingService: vi.fn(),
  }));

  vi.mock("../../src/services/client.service.js", () => ({
    getClientService: vi.fn(() => mockClientService),
    ClientService: vi.fn(() => mockClientService),
    resetClientService: vi.fn(),
  }));

  vi.mock("../../src/services/profile.service.js", () => ({
    getProfileService: vi.fn(() => mockProfileService),
    ProfileService: vi.fn(() => mockProfileService),
    resetProfileService: vi.fn(),
  }));

  vi.mock("../../src/services/settings.service.js", () => ({
    getSettingsService: vi.fn(() => mockSettingsService),
    SettingsService: vi.fn(() => mockSettingsService),
    resetSettingsService: vi.fn(),
  }));

  vi.mock("../../src/services/daemon.service.js", () => ({
    getDaemonService: vi.fn(() => mockDaemonService),
    DaemonService: vi.fn(() => mockDaemonService),
    resetDaemonService: vi.fn(),
  }));

  vi.mock("../../src/services/auth.service.js", () => ({
    getAuthService: vi.fn(() => mockAuthService),
    AuthService: vi.fn(() => mockAuthService),
    resetAuthService: vi.fn(),
  }));

  vi.mock("../../src/services/import-export.service.js", () => ({
    getImportExportService: vi.fn(() => mockImportExportService),
    ImportExportService: vi.fn(() => mockImportExportService),
    resetImportExportService: vi.fn(),
  }));

  vi.mock("../../src/shared/formatters.js", () => ({
    formatTokens: vi.fn((n: number) => n.toLocaleString()),
    formatSwitchable: vi.fn((label: string) => `◀ ${label} ▶`),
    outputJson: vi.fn(),
  }));
}

// Sample test data
export const sampleLocalServers = [
  { id: "server1", name: "Server One", command: "node", args: ["server.js"], disabled: false },
  { id: "server2", name: "Server Two", command: "python", args: ["-m", "server"], disabled: true },
  { id: "server3", name: "Server Three", command: "npx", args: ["mcp-server"], disabled: false },
];

export const sampleRemoteServers = [
  {
    id: "remote1",
    name: "Remote One",
    url: "http://localhost:3000",
    type: "sse" as const,
    disabled: false,
  },
  {
    id: "remote2",
    name: "Remote Two",
    url: "https://api.example.com/mcp",
    type: "http" as const,
    disabled: false,
  },
];

// Helper to wait for async state updates
export const waitForStateUpdate = (ms = 150): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Helper to simulate key press
export const KEYS = {
  UP: "\x1B[A",
  DOWN: "\x1B[B",
  LEFT: "\x1B[D",
  RIGHT: "\x1B[C",
  ENTER: "\r",
  ESCAPE: "\x1B",
  SPACE: " ",
  TAB: "\t",
  BACKSPACE: "\x7F",
};

/**
 * Render a component with QueryClientProvider and ThemeProvider wrappers
 * This ensures all components have access to the query client and theme context
 */
export function render(component: React.ReactElement): ReturnType<typeof inkRender> {
  const queryClient = createTestQueryClient();
  return inkRender(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ThemeProvider, null, component)
    )
  );
}
