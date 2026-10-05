/**
 * AddServerScreen Tests
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "../setup.js";
import {
  mockAuthService,
  mockConfigService,
  mockDaemonService,
  mockTestingService,
  waitForStateUpdate,
  KEYS,
} from "../setup.js";

// Setup mocks before importing component
vi.mock("../../../src/services/config.service.js", () => ({
  getConfigService: vi.fn(() => mockConfigService),
}));

vi.mock("../../../src/services/testing.service.js", () => ({
  getTestingService: vi.fn(() => mockTestingService),
}));

vi.mock("../../../src/services/auth.service.js", () => ({
  getAuthService: vi.fn(() => mockAuthService),
}));

vi.mock("../../../src/services/daemon.service.js", () => ({
  getDaemonService: vi.fn(() => mockDaemonService),
}));

vi.mock("open", () => ({
  default: vi.fn(() => Promise.resolve()),
}));

import { AddServerScreen } from "../../../src/tui/screens/AddServerScreen.js";

const submitInput = async (
  stdin: { write: (input: string) => void },
  value?: string
): Promise<void> => {
  if (value !== undefined) {
    stdin.write(value);
    await waitForStateUpdate(50);
  }
  stdin.write(KEYS.ENTER);
  await waitForStateUpdate();
};

describe("AddServerScreen", () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService.getLocalServers.mockReturnValue([]);
    mockConfigService.getRemoteServers.mockReturnValue([]);
    mockConfigService.generateServerId.mockImplementation((name: string) =>
      name.toLowerCase().replace(/\s+/g, "-")
    );
    mockConfigService.addLocalServer.mockReturnValue({ success: true });
    mockConfigService.addRemoteServer.mockReturnValue({ success: true });
    mockConfigService.updateRemoteServer.mockResolvedValue({ success: true });
    mockTestingService.testLocalServer.mockResolvedValue({ success: true, toolCount: 5 });
    mockTestingService.testRemoteServer.mockResolvedValue({ success: true, toolCount: 3 });
    mockDaemonService.isDaemonRunning.mockReturnValue({ running: false, pid: null });
    mockDaemonService.refreshDaemon.mockResolvedValue({ success: true });
    mockAuthService.startOAuthFlow.mockResolvedValue({
      authUrl: "https://auth.example.test",
      state: "state-1",
    });
    mockAuthService.waitForAuth.mockResolvedValue({
      success: true,
      expiresAt: Date.now() + 60_000,
    });
  });

  describe("Rendering", () => {
    it("should render the add server screen with title", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Add Server");
    });

    it("should display server name input field", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Server name");
    });

    it("should display help text about ESC", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      expect(lastFrame()).toMatch(/ESC.*Go back|Go back/i);
    });

    it("should show navigation hints", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      expect(lastFrame()).toMatch(/ENTER|ESC|next|back/i);
    });
  });

  describe("Navigation", () => {
    it("should call onBack when ESC is pressed on first step", () => {
      const { stdin } = render(<AddServerScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ESCAPE);

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should not call onBack when ESC is pressed on later steps", async () => {
      const { stdin, lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      // Enter server name and proceed
      stdin.write("test-server");
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // Now ESC should go back to previous step, not call onBack
      stdin.write(KEYS.ESCAPE);
      await waitForStateUpdate();

      // Should still be in the wizard
      expect(lastFrame()).toContain("Server name");
    });
  });

  describe("Form Structure", () => {
    it("should display initial form for server creation", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      // Should show initial form
      expect(lastFrame()).toContain("Server name");
    });

    it("should have a styled header", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Add Server");
    });
  });

  describe("Server Creation", () => {
    it("should display server creation form", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      // Should show the form
      expect(lastFrame()).toContain("Add Server");
      expect(lastFrame()).toContain("Server name");
    });

    it("should have help text about creating servers", () => {
      const { lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      // Should show help text
      expect(lastFrame()).toMatch(/ESC|ENTER|next|back/i);
    });

    it("should add and test a local stdio server", async () => {
      const { stdin, lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      await submitInput(stdin, "Local Test");
      await submitInput(stdin);
      await submitInput(stdin, "node");
      await submitInput(stdin, "server.js --flag");
      await submitInput(stdin, "API_KEY=secret");
      await waitForStateUpdate(500);

      expect(mockConfigService.addLocalServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "local-test",
          name: "Local Test",
          command: "node",
          args: ["server.js", "--flag"],
          env: { API_KEY: "secret" },
        })
      );
      expect(mockTestingService.testLocalServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "local-test" })
      );
      expect(lastFrame()).toContain("OK");

      stdin.write("x");
      await waitForStateUpdate();

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should show validation errors for missing and duplicate server names", async () => {
      const { stdin, lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      await submitInput(stdin);

      expect(lastFrame()).toContain("Name is required");

      mockConfigService.getLocalServers.mockReturnValue([
        { id: "dup", name: "Duplicate", command: "node", args: [] },
      ]);

      await submitInput(stdin, "Duplicate");

      expect(lastFrame()).toContain("already exists");
    });

    it("should show an add failure without testing the server", async () => {
      mockConfigService.addLocalServer.mockReturnValue({
        success: false,
        error: "write failed",
      });

      const { stdin, lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      await submitInput(stdin, "Broken Local");
      await submitInput(stdin);
      await submitInput(stdin, "node");
      await submitInput(stdin, "server.js");
      await submitInput(stdin, "DEBUG=true");
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate(500);

      expect(lastFrame()).toContain("write failed");
      expect(mockTestingService.testLocalServer).not.toHaveBeenCalled();
    });

    it("should add and test a remote HTTP server without OAuth", async () => {
      const { stdin, lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      await submitInput(stdin, "Remote Test");
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      await submitInput(stdin);
      await submitInput(stdin, "https://mcp.example.test/mcp");
      await submitInput(stdin, "bearer-token");
      await submitInput(stdin);
      await waitForStateUpdate(500);

      expect(mockConfigService.addRemoteServer).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "remote-test",
          name: "Remote Test",
          type: "http",
          url: "https://mcp.example.test/mcp",
          bearerToken: "bearer-token",
        })
      );
      expect(mockTestingService.testRemoteServer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "remote-test" }),
        true
      );
      expect(lastFrame()).toContain("OK");
    });

    it("should run OAuth when a remote server test requires authentication", async () => {
      mockTestingService.testRemoteServer
        .mockResolvedValueOnce({
          success: false,
          requiresAuth: true,
          authRequirements: { issuer: "https://auth.example.test" },
        })
        .mockResolvedValueOnce({ success: true, toolCount: 4 });

      const { stdin, lastFrame } = render(<AddServerScreen onBack={mockOnBack} />);

      await submitInput(stdin, "OAuth Remote");
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      await submitInput(stdin);
      await submitInput(stdin, "https://oauth.example.test/mcp");
      await submitInput(stdin);
      await submitInput(stdin);
      await waitForStateUpdate(700);

      expect(mockConfigService.updateRemoteServer).toHaveBeenCalledWith("oauth-remote", {
        oauth: { enabled: true },
      });
      expect(mockAuthService.startOAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({ id: "oauth-remote", oauth: { enabled: true } }),
        { issuer: "https://auth.example.test" }
      );
      expect(mockAuthService.waitForAuth).toHaveBeenCalledWith("state-1");
      expect(mockAuthService.stopCallbackServer).toHaveBeenCalled();
      expect(mockTestingService.testRemoteServer).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "oauth-remote", oauth: { enabled: true } })
      );
      expect(lastFrame()).toContain("OK");
    });
  });
});
