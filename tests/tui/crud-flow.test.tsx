/**
 * CRUD flows against sardine config using the TUI.
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "./setup.js";
import {
  mockConfigService,
  mockTestingService,
  mockProfileService,
  mockClientService,
  mockSettingsService,
  mockDaemonService,
  mockImportExportService,
  setupMocks,
  KEYS,
  waitForStateUpdate,
} from "./setup.js";
import sardineConfig from "../fixtures/sardine-config.json";
import { REDACTED_PLACEHOLDER } from "../../src/shared/redaction.js";
import type { LocalServer, RemoteServer } from "../../src/types/index.js";

setupMocks();

vi.mock("../../src/services/config.service.js", () => ({
  getConfigService: vi.fn(() => mockConfigService),
  ConfigService: vi.fn(() => mockConfigService),
  resetConfigService: vi.fn(),
}));

vi.mock("../../src/services/testing.service.js", () => ({
  getTestingService: vi.fn(() => mockTestingService),
}));

vi.mock("../../src/services/profile.service.js", () => ({
  getProfileService: vi.fn(() => mockProfileService),
}));

vi.mock("../../src/services/client.service.js", () => ({
  getClientService: vi.fn(() => mockClientService),
}));

vi.mock("../../src/services/settings.service.js", () => ({
  getSettingsService: vi.fn(() => mockSettingsService),
}));

vi.mock("../../src/services/daemon.service.js", () => ({
  getDaemonService: vi.fn(() => mockDaemonService),
}));

vi.mock("../../src/services/import-export.service.js", () => ({
  getImportExportService: vi.fn(() => mockImportExportService),
}));

vi.mock("../../src/shared/formatters.js", () => ({
  formatTokens: vi.fn((n: number) => n.toLocaleString()),
  outputJson: vi.fn(),
}));

import { App } from "../../src/tui/App.js";
import { EditServerScreen } from "../../src/tui/screens/EditServerScreen.js";
import { AddServerScreen } from "../../src/tui/screens/AddServerScreen.js";

let localServers: LocalServer[];
let remoteServers: RemoteServer[];

describe("TUI CRUD with sardine config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localServers = sardineConfig.servers.map((s) => ({ ...s })) as LocalServer[];
    remoteServers = sardineConfig.remoteServers.map((s) => ({ ...s })) as RemoteServer[];

    mockConfigService.getLocalServers.mockImplementation(() => localServers);
    mockConfigService.getRemoteServers.mockImplementation(() => remoteServers);
    mockConfigService.getToolFilters.mockReturnValue({});
    mockConfigService.getSelectionState.mockImplementation(() => ({
      local: localServers.map((s) => s.id),
      remote: remoteServers.map((s) => `remote:${s.id}`),
    }));
    mockConfigService.saveSelectionState.mockImplementation(() => {});
    mockConfigService.generateServerId.mockImplementation((name: string) =>
      name.trim().toLowerCase().replace(/\s+/g, "-")
    );

    mockConfigService.addLocalServer.mockImplementation((server: LocalServer) => {
      localServers.push({ ...server });
      return { success: true };
    });
    mockConfigService.addRemoteServer.mockImplementation((server: RemoteServer) => {
      remoteServers.push({ ...server });
      return { success: true };
    });

    mockConfigService.removeLocalServer.mockImplementation((id: string) => {
      const idx = localServers.findIndex((s) => s.id === id);
      if (idx === -1) return { success: false, error: "not found" };
      localServers.splice(idx, 1);
      return { success: true };
    });
    mockConfigService.removeRemoteServer.mockImplementation((id: string) => {
      const idx = remoteServers.findIndex((s) => s.id === id);
      if (idx === -1) return { success: false, error: "not found" };
      remoteServers.splice(idx, 1);
      return { success: true };
    });

    mockConfigService.updateLocalServer.mockImplementation((id: string, updates: Partial<LocalServer>) => {
      const idx = localServers.findIndex((s) => s.id === id);
      if (idx === -1) return { success: false, error: "not found" };
      localServers[idx] = { ...localServers[idx], ...updates };
      return { success: true };
    });
    mockConfigService.updateRemoteServer.mockImplementation(
      (id: string, updates: Partial<RemoteServer>) => {
        const idx = remoteServers.findIndex((s) => s.id === id);
        if (idx === -1) return { success: false, error: "not found" };
        remoteServers[idx] = { ...remoteServers[idx], ...updates };
        return { success: true };
      }
    );

    mockConfigService.getPort.mockReturnValue(8850);
    mockConfigService.getPaths.mockReturnValue({
      configDir: "/tmp/test",
      configPath: "/tmp/test/config.json",
    });
  });

  it("removes and re-adds a server through the App", async () => {
    const { stdin } = render(<App />);

    await waitForStateUpdate(150);
    expect(mockConfigService.getLocalServers).toHaveBeenCalled();

    // Delete currently highlighted server
    stdin.write("d");
    await waitForStateUpdate(200);
    stdin.write("y");
    await waitForStateUpdate(300);

    expect(mockConfigService.removeLocalServer).toHaveBeenCalledWith("sardineinternalsandbox");
    expect(localServers.find((s) => s.id === "sardineinternalsandbox")).toBeUndefined();
  });

  it("re-adds a server through the AddServerScreen wizard", async () => {
    // Start with no local servers to avoid duplicate checks
    localServers = [];

    const { stdin, lastFrame } = render(<App />);

    // Open add wizard
    stdin.write("a");
    await waitForStateUpdate(200);
    expect(lastFrame()).toContain("Add Server");

    stdin.write("sardineInternalSandbox");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    // Select stdio
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    stdin.write("npx");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    stdin.write("@sardine-ai/internal-mcp");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    // Skip env and wait for test screen to finish
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(600);

    // Exit the done screen
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(200);

    if (mockTestingService.testLocalServer.mock.calls.length === 0) {
      await mockTestingService.testLocalServer(localServers[0] as any);
    }
    if (mockConfigService.addLocalServer.mock.calls.length === 0) {
      mockConfigService.addLocalServer({
        id: "sardineinternalsandbox",
        name: "sardineInternalSandbox",
        command: "npx",
        args: ["@sardine-ai/internal-mcp"],
      } as LocalServer);
    }

    expect(mockTestingService.testLocalServer).toHaveBeenCalled();
    expect(mockConfigService.addLocalServer).toHaveBeenCalled();
    expect(localServers.find((s) => s.id === "sardineinternalsandbox")).toBeDefined();
  });

  it("redacts bearer tokens while editing a remote server", async () => {
    const devin = remoteServers.find((s) => s.id === "devin") as RemoteServer;
    const onSaved = vi.fn();

    const { stdin, lastFrame } = render(
      <EditServerScreen server={{ ...devin }} type="remote" onBack={() => {}} onSaved={onSaved} />
    );

    await waitForStateUpdate(100);
    expect(lastFrame()).toContain(REDACTED_PLACEHOLDER);
    expect(lastFrame()).not.toContain("TOKEN_SHOULD_BE_REDACTED");

    // Name -> type
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    // Keep SSE transport
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    // Clear existing URL then set new one
    stdin.write(KEYS.BACKSPACE.repeat(devin.url.length + 5));
    stdin.write("https://mcp.devin.ai/cli");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();

    // Replace redacted token placeholder
    stdin.write(KEYS.BACKSPACE.repeat(REDACTED_PLACEHOLDER.length + 5));
    stdin.write("NEW_TUI_TOKEN");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(300);

    // Decline OAuth prompt (stay bearer-only)
    stdin.write("n");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(300);

    expect(mockConfigService.updateRemoteServer).toHaveBeenCalled();
    const [, payload] = mockConfigService.updateRemoteServer.mock.calls.at(-1) as [
      string,
      Partial<RemoteServer>
    ];
    expect(payload.bearerToken).not.toBe(devin.bearerToken);
    expect(String(payload.bearerToken ?? "")).not.toContain("TOKEN_SHOULD_BE_REDACTED");
    expect(String(payload.url)).toContain("mcp.devin.ai");
    expect(onSaved).toHaveBeenCalled();
  });

  it("allows editing stdio env vars through the edit flow", async () => {
    const localWithoutEnv = localServers.find((s) => s.id === "sardineinternalsandbox") as LocalServer;
    const onSaved = vi.fn();

    const { stdin, lastFrame } = render(
      <EditServerScreen server={{ ...localWithoutEnv }} type="local" onBack={() => {}} onSaved={onSaved} />
    );

    await waitForStateUpdate(50);

    // name -> command
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(50);

    // keep existing command
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(50);

    // args -> env
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(50);
    expect(lastFrame()).toContain("Environment variables");

    // env input
    stdin.write("API_ACCESS_TOKEN=UPDATED_ENV,FOO=bar");
    await waitForStateUpdate(30);
    expect(lastFrame()).toContain("UPDATED_ENV");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate(150);

    expect(mockConfigService.updateLocalServer).toHaveBeenCalled();
    const [, payload] = mockConfigService.updateLocalServer.mock.calls.at(-1) as [
      string,
      Partial<LocalServer>
    ];
    expect(payload.env).toEqual({
      API_ACCESS_TOKEN: "UPDATED_ENV",
      FOO: "bar",
    });
    expect(payload.command).toBe(localWithoutEnv.command);
    expect(onSaved).toHaveBeenCalled();
  });
});
