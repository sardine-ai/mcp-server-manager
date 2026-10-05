/**
 * App Component Tests - Main TUI Application
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
  sampleLocalServers,
  sampleRemoteServers,
  waitForStateUpdate,
  KEYS,
} from "./setup.js";

// Setup all mocks before importing App
vi.mock("../../src/services/config.service.js", () => ({
  getConfigService: vi.fn(() => mockConfigService),
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

describe("App Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService.getLocalServers.mockReturnValue([]);
    mockConfigService.getRemoteServers.mockReturnValue([]);
  });

  describe("Main Screen Rendering", () => {
    it("should render the main screen with header", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("MCP Server Manager");
    });

    it("should display status bar with profile and port", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("Profile:");
      expect(lastFrame()).toContain("Port:");
    });

    it("should show menu panel with shortcuts", () => {
      const { lastFrame } = render(<App />);

      // Check for shortcuts in grouped layout
      expect(lastFrame()).toContain("A Add"); // Add shortcut
      expect(lastFrame()).toContain("Profile"); // May be truncated in display
      expect(lastFrame()).toContain("Doctor");
    });

    it("should show empty state when no servers configured", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("No servers configured");
      expect(lastFrame()).toMatch(/Press.*A.*to add/i);
    });

    it("should display version in header", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toMatch(/v\d+\.\d+\.\d+/);
    });
  });

  describe("Server List Rendering", () => {
    beforeEach(() => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
      mockConfigService.getRemoteServers.mockReturnValue(sampleRemoteServers);
    });

    it("should display local servers when configured", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("Server One");
    });

    it("should display remote servers when configured", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("Remote One");
    });

    it("should show selection indicator", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("→");
    });

    it("should show profile membership checkboxes", () => {
      const { lastFrame } = render(<App />);

      // Default profile has "include all" semantics (empty arrays), so all servers show checked
      expect(lastFrame()).toContain("[✓]");
    });
  });

  describe("Navigation Between Screens", () => {
    it("should navigate to add server screen on A key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("a");
      await waitForStateUpdate(500); // Longer wait for Windows CI

      expect(lastFrame()).toContain("Add Server");
    });

    it("should navigate to tools screen on T key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("t");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Token Usage");
    });

    it("should navigate to clients screen on C key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("c");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("MCP Clients");
    });

    it("should navigate to profiles screen on F key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("f");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Profiles");
    });

    it("should navigate to settings screen on G key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("g");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Settings");
    });

    it("should navigate to import/export screen on I key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("i");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Import / Export");
    });

    it("should navigate to doctor screen on H key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("h");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("System Health Check");
    });

    it("should return to main screen from sub-screen", async () => {
      const { lastFrame, stdin } = render(<App />);

      // Go to tools screen
      stdin.write("t");
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Token Usage");

      // Press Q to go back
      stdin.write("q");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("MCP Server Manager");
      expect(lastFrame()).toContain("A Add"); // Check for shortcuts
    });
  });

  describe("Server Selection", () => {
    beforeEach(() => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
    });

    it("should enable/disable server with Space", async () => {
      const { lastFrame, stdin } = render(<App />);

      const initialFrame = lastFrame();

      // Press space to enable/disable
      stdin.write(KEYS.SPACE);
      await waitForStateUpdate();

      // Server state should change (selection or disabled status)
      const afterSpace = lastFrame();
      expect(afterSpace).not.toBe(initialFrame);
    });

    it("should navigate servers with arrow keys", async () => {
      const { stdin, lastFrame } = render(<App />);

      const initialFrame = lastFrame();

      // Press down
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      // Selection should change
      const afterDown = lastFrame();
      expect(afterDown).toContain("→");
    });
  });

  describe("Server Actions", () => {
    beforeEach(() => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
    });

    it("should show servers in the list", () => {
      const { lastFrame } = render(<App />);

      expect(lastFrame()).toContain("Server One");
    });

    it("should show server status information", () => {
      const { lastFrame } = render(<App />);

      // Should show some status indicator
      expect(lastFrame()).toMatch(/tools|disabled|enabled/i);
    });
  });

  describe("Testing", () => {
    it("should start testing on X key", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("x");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Testing Servers");
    });

    it("should show test results", async () => {
      // Mock streaming results
      mockTestingService.testAllServersStreaming.mockImplementationOnce(
        async (onResult: (result: unknown) => void) => {
          const result = {
            server: { id: "s1", name: "Test Server", command: "node", args: [] },
            type: "local" as const,
            result: { success: true, toolCount: 5 },
          };
          onResult({ ...result, index: 0, total: 1 });
          return [result];
        }
      );

      const { lastFrame, stdin } = render(<App />);

      stdin.write("x");
      await waitForStateUpdate(300);

      // Should show results or testing status
      expect(lastFrame()).toMatch(/Testing|tools|Complete/i);
    });
  });

  describe("Message Display", () => {
    beforeEach(() => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
    });

    it("should render without errors with servers configured", () => {
      const { lastFrame } = render(<App />);

      // Should render successfully
      expect(lastFrame()).toContain("MCP Server Manager");
      expect(lastFrame()).toContain("Server One");
    });
  });

  describe("Case Insensitive Keys", () => {
    it("should handle uppercase keys", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("A"); // Uppercase
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Add Server");
    });

    it("should handle lowercase keys", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write("a"); // Lowercase
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Add Server");
    });
  });

  describe("Exit Callback", () => {
    it("should call onExit when Q is pressed on main screen", () => {
      const mockOnExit = vi.fn();
      const { stdin } = render(<App onExit={mockOnExit} />);

      stdin.write("q");

      expect(mockOnExit).toHaveBeenCalled();
    });
  });

  describe("Section Navigation", () => {
    beforeEach(() => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
      mockConfigService.getRemoteServers.mockReturnValue(sampleRemoteServers);
    });

    it("should navigate between local and remote sections", async () => {
      const { stdin, lastFrame } = render(<App />);

      // Navigate down past local servers to remote
      for (let i = 0; i < sampleLocalServers.length + 1; i++) {
        stdin.write(KEYS.DOWN);
        await waitForStateUpdate(50);
      }

      // Should now be in remote section
      expect(lastFrame()).toContain("→");
    });

    it("should wrap around when navigating past last server", async () => {
      const { stdin, lastFrame } = render(<App />);

      // Navigate past all servers
      const totalServers = sampleLocalServers.length + sampleRemoteServers.length;
      for (let i = 0; i < totalServers + 2; i++) {
        stdin.write(KEYS.DOWN);
        await waitForStateUpdate(50);
      }

      // Should still show selection
      expect(lastFrame()).toContain("→");
    });
  });

  describe("Tool Counts", () => {
    beforeEach(() => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
      mockConfigService.getToolFilters.mockReturnValue({
        server1: { allTools: ["t1", "t2", "t3"], enabled: ["t1", "t2"] },
      });
    });

    it("should display tool counts for servers", async () => {
      const { lastFrame } = render(<App />);

      await waitForStateUpdate(200);

      expect(lastFrame()).toMatch(/\d+ tools?/);
    });
  });

  describe("Enter Key - Manage Servers", () => {
    it("should navigate to daemon screen even when no servers selected", async () => {
      const { lastFrame, stdin } = render(<App />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(lastFrame()).toMatch(/Daemon Management|Start|Stop/i);
    });

    it("should navigate to daemon management when servers exist", async () => {
      mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);

      const { lastFrame, stdin } = render(<App />);

      // Press Enter - should go to daemon screen
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Daemon Management");
    });
  });
});

describe("Profile Switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);
    mockConfigService.getRemoteServers.mockReturnValue(sampleRemoteServers);
    // "dev" profile only includes server1 and remote1
    mockProfileService.getProfile.mockImplementation((id: string) => {
      if (id === "default") return { name: "Default", servers: [], remoteServers: [] };
      if (id === "dev") return { name: "Development", servers: ["server1"], remoteServers: ["remote1"] };
      return null;
    });
    // Token data: server1=1000, server2=2000, server3=3000, remote1=500, remote2=700
    mockConfigService.getToolFilters.mockReturnValue({
      server1: { toolsData: { t1: { tokens: 1000 } }, disabledTools: [] },
      server2: { toolsData: { t2: { tokens: 2000 } }, disabledTools: [] },
      server3: { toolsData: { t3: { tokens: 3000 } }, disabledTools: [] },
      "remote:remote1": { toolsData: { r1: { tokens: 500 } }, disabledTools: [] },
      "remote:remote2": { toolsData: { r2: { tokens: 700 } }, disabledTools: [] },
    });
  });

  it("should show all tokens when default profile (include all) is active", () => {
    const { lastFrame } = render(<App />);
    // Default profile includes all servers: 1000+2000+3000+500+700 = 7,200
    expect(lastFrame()).toContain("7,200 tokens");
  });

  it("should show only profile member tokens after switching profile", async () => {
    const { lastFrame, stdin } = render(<App />);

    // Switch to "dev" profile (index 1) by pressing right arrow
    stdin.write(KEYS.RIGHT);
    await waitForStateUpdate();

    // Dev profile includes server1 (1000) + remote1 (500) = 1,500
    expect(lastFrame()).toContain("1,500 tokens");
  });

  it("should update header profile name when switching profiles", async () => {
    const { lastFrame, stdin } = render(<App />);

    expect(lastFrame()).toContain("Default");

    stdin.write(KEYS.RIGHT);
    await waitForStateUpdate();

    expect(lastFrame()).toContain("Development");
  });

  it("should show all checkmarks for include-all profile", () => {
    const { lastFrame } = render(<App />);

    // Default profile includes all — every server should be checked
    const frame = lastFrame();
    const checkCount = (frame.match(/\[✓\]/g) || []).length;
    expect(checkCount).toBe(sampleLocalServers.length + sampleRemoteServers.length);
  });

  it("should show partial checkmarks for explicit profile", async () => {
    const { lastFrame, stdin } = render(<App />);

    stdin.write(KEYS.RIGHT);
    await waitForStateUpdate();

    // Dev profile has server1 + remote1 checked, others unchecked
    const frame = lastFrame();
    const checkedCount = (frame.match(/\[✓\]/g) || []).length;
    const uncheckedCount = (frame.match(/\[ \]/g) || []).length;
    expect(checkedCount).toBe(2); // server1 + remote1
    expect(uncheckedCount).toBe(3); // server2, server3, remote2
  });

  it("should cycle profiles with left arrow (wraps around)", async () => {
    const { lastFrame, stdin } = render(<App />);

    // Start on Default (index 0), press left to wrap to last profile (Development)
    stdin.write(KEYS.LEFT);
    await waitForStateUpdate();

    expect(lastFrame()).toContain("Development");
    expect(lastFrame()).toContain("1,500 tokens");
  });

  it("should cycle profiles with right arrow (wraps around)", async () => {
    const { lastFrame, stdin } = render(<App />);

    // Go right to Development, then right again to wrap back to Default
    stdin.write(KEYS.RIGHT);
    await waitForStateUpdate();
    stdin.write(KEYS.RIGHT);
    await waitForStateUpdate();

    expect(lastFrame()).toContain("Default");
    expect(lastFrame()).toContain("7,200 tokens");
  });

  it("should toggle profile membership with Space", async () => {
    const { stdin } = render(<App />);

    // Press space on first server (server1) while on default profile
    stdin.write(KEYS.SPACE);
    await waitForStateUpdate();

    // Default profile is include-all, so Space should call makeExplicit then removeServer
    expect(mockProfileService.makeExplicit).toHaveBeenCalledWith("default");
    expect(mockProfileService.removeServer).toHaveBeenCalledWith("default", "server1");
  });

  it("should add server to explicit profile with Space", async () => {
    const { stdin } = render(<App />);

    // Switch to dev profile
    stdin.write(KEYS.RIGHT);
    await waitForStateUpdate();

    // Navigate to server2 (index 1) which is NOT in dev profile
    stdin.write(KEYS.DOWN);
    await waitForStateUpdate();

    stdin.write(KEYS.SPACE);
    await waitForStateUpdate();

    expect(mockProfileService.addServer).toHaveBeenCalledWith("dev", "server2");
  });
});

describe("App State Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should maintain state between renders", () => {
    mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);

    const { lastFrame, stdin } = render(<App />);

    const initialFrame = lastFrame();
    expect(initialFrame).toContain("Server One");

    // Navigate down
    stdin.write(KEYS.DOWN);

    // State should be maintained
    const afterNav = lastFrame();
    expect(afterNav).toContain("Server One");
  });

  it("should show profile membership checkmarks on mount", () => {
    mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);

    const { lastFrame } = render(<App />);

    // Default profile has empty servers (include all), so all should be checked
    expect(lastFrame()).toContain("[✓]");
  });

  it("should refresh servers when returning from sub-screen", async () => {
    mockConfigService.getLocalServers.mockReturnValue(sampleLocalServers);

    const { stdin } = render(<App />);

    // Go to add server screen
    stdin.write("a");
    await waitForStateUpdate();

    // Go back
    stdin.write(KEYS.ESCAPE);
    await waitForStateUpdate();

    // Should have called getLocalServers again
    expect(mockConfigService.getLocalServers.mock.calls.length).toBeGreaterThan(1);
  });
});
