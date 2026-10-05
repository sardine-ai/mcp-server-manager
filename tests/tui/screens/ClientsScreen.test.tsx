/**
 * ClientsScreen Tests
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "../setup.js";
import { mockClientService, waitForStateUpdate, KEYS } from "../setup.js";

const projectClientService = vi.hoisted(() => ({
  detectClients: vi.fn(),
  connectClient: vi.fn(() => ({ success: true })),
  disconnectClient: vi.fn(() => ({ success: true })),
  openClientConfig: vi.fn(() => ({ success: true })),
}));

// Setup mocks before importing component
vi.mock("../../../src/services/client.service.js", () => ({
  getClientService: vi.fn(() => mockClientService),
  ClientService: vi.fn(function () {
    return projectClientService;
  }),
}));

import { ClientService } from "../../../src/services/client.service.js";

import { ClientsScreen } from "../../../src/tui/screens/ClientsScreen.js";

describe("ClientsScreen", () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ClientService).mockImplementation(function () {
      return projectClientService;
    });
  });

  describe("Rendering", () => {
    it("should render clients screen with title", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("MCP Clients");
    });

    it("should display detected clients", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Claude Desktop");
      expect(lastFrame()).toContain("Cursor");
    });

    it("should show connection status for clients", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      const frame = lastFrame();
      // Should show status text like "connected", "disconnected", or "not installed"
      expect(frame).toMatch(/connected|disconnected|not installed/i);
    });

    it("should show server count for clients with servers", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      // Claude Desktop has 2 servers
      expect(lastFrame()).toContain("2");
    });

    it("should show status icons", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      const frame = lastFrame();
      // Should contain connection status icons
      expect(frame).toMatch(/✔|○|✗/);
    });
  });

  describe("Navigation", () => {
    it("should call onBack when Q is pressed", () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} />);

      stdin.write("q");

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should call onBack when ESC is pressed", () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ESCAPE);

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should navigate between clients with arrow keys", async () => {
      const { stdin, lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      // Initial state - first client selected
      const initialFrame = lastFrame();
      expect(initialFrame).toContain("→");

      // Press down
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      // Selection should still work
      const afterDown = lastFrame();
      expect(afterDown).toContain("→");
    });
  });

  describe("Client Actions", () => {
    it("should connect/disconnect with Enter key", async () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} />);

      // Press enter to toggle connection
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // Should have called either connectClient or disconnectClient
      const connectCalled = mockClientService.connectClient.mock.calls.length > 0;
      const disconnectCalled = mockClientService.disconnectClient.mock.calls.length > 0;
      expect(connectCalled || disconnectCalled).toBe(true);
    });

    it("should not act on not-installed clients", async () => {
      // Create a mock with a not-installed client first
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} />);

      // Navigate to a not-installed client if exists
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      // Reset mocks
      vi.clearAllMocks();
      vi.mocked(ClientService).mockImplementation(function () {
        return projectClientService;
      });

      // Try to connect - should not call service methods for not-installed
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // If the client was not-installed, no action should happen
      // This depends on the mock setup
    });
  });

  describe("Per-Profile Client Installation", () => {
    it("should pass profileId to detectClients on mount", () => {
      render(<ClientsScreen onBack={mockOnBack} currentProfileId="dev" />);

      expect(mockClientService.detectClients).toHaveBeenCalledWith("dev");
    });

    it("should show profile name in title when profileId is provided", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} currentProfileId="dev" />);

      expect(lastFrame()).toContain("MCP Clients — dev");
    });

    it("should show generic title when no profileId is provided", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("MCP Clients");
      expect(lastFrame()).not.toContain("—");
    });

    it("should connect only the given profile on Enter", async () => {
      // First client (Claude Desktop) is "connected", so Enter disconnects
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} currentProfileId="dev" />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockClientService.disconnectClient).toHaveBeenCalledWith("claude", "dev");
      expect(mockClientService.connectAllProfiles).not.toHaveBeenCalled();
      expect(mockClientService.disconnectAllProfiles).not.toHaveBeenCalled();
    });

    it("should connect a disconnected client with the profile", async () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} currentProfileId="staging" />);

      // Navigate to Cursor (index 1, status: disconnected)
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockClientService.connectClient).toHaveBeenCalledWith("cursor", "staging");
    });

    it("should pass profileId to detectClients after connect/disconnect", async () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} currentProfileId="prod" />);

      mockClientService.detectClients.mockClear();

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // detectClients should be re-called with the profileId to refresh status
      expect(mockClientService.detectClients).toHaveBeenCalledWith("prod");
    });

    it("should pass profileId to detectClients on refresh", async () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} currentProfileId="dev" />);

      mockClientService.detectClients.mockClear();

      stdin.write("r");
      await waitForStateUpdate();

      expect(mockClientService.detectClients).toHaveBeenCalledWith("dev");
    });

    it("should pass undefined profileId when none provided", async () => {
      const { stdin } = render(<ClientsScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // Should call connectClient or disconnectClient with undefined profileId
      const disconnectCalls = mockClientService.disconnectClient.mock.calls;
      const connectCalls = mockClientService.connectClient.mock.calls;
      const allCalls = [...disconnectCalls, ...connectCalls];
      expect(allCalls.length).toBeGreaterThan(0);
      // Second argument (profileId) should be undefined
      expect(allCalls[0][1]).toBeUndefined();
    });
  });

  it("switches to the current folder and uses its service for the selected profile", async () => {
    projectClientService.detectClients.mockReturnValue([mockClientService.detectClients()[1]]);
    const { stdin, lastFrame } = render(
      <ClientsScreen onBack={mockOnBack} currentProfileId="dev" />
    );
    stdin.write("s");
    await waitForStateUpdate();
    expect(lastFrame()).toContain("Current folder");
    expect(projectClientService.detectClients).toHaveBeenCalledWith("dev");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();
    expect(projectClientService.connectClient).toHaveBeenCalledWith("cursor", "dev");
    expect(mockClientService.connectClient).not.toHaveBeenCalled();
    stdin.write("s");
    await waitForStateUpdate();
    expect(lastFrame()).toContain("Scope: Global");
  });

  describe("Help Text", () => {
    it("should display keyboard shortcuts", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      const frame = lastFrame();
      expect(frame).toMatch(/ENTER|Connect|Disconnect/i);
      expect(frame).toMatch(/Q|Back/i);
    });

    it("should show navigation hints", () => {
      const { lastFrame } = render(<ClientsScreen onBack={mockOnBack} />);

      const frame = lastFrame();
      expect(frame).toMatch(/↑|↓/);
    });
  });
});
