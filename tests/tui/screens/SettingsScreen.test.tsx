/**
 * SettingsScreen Tests
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { spawnSync } from "child_process";
import { render } from "../setup.js";
import {
  mockClientService,
  mockConfigService,
  mockSettings,
  mockSettingsService,
  waitForStateUpdate,
  KEYS,
} from "../setup.js";

// Setup mocks before importing component
vi.mock("../../../src/services/settings.service.js", () => ({
  getSettingsService: vi.fn(() => mockSettingsService),
}));

vi.mock("../../../src/services/client.service.js", () => ({
  getClientService: vi.fn(() => mockClientService),
}));

vi.mock("../../../src/services/config.service.js", () => ({
  getConfigService: vi.fn(() => mockConfigService),
}));

vi.mock("child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

import { SettingsScreen } from "../../../src/tui/screens/SettingsScreen.js";

describe("SettingsScreen", () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getAll.mockReturnValue({ ...mockSettings });
    mockSettingsService.getKeys.mockReturnValue(
      Object.keys(mockSettings) as (keyof typeof mockSettings)[]
    );
    mockSettingsService.get.mockImplementation(
      (key: string) => mockSettings[key as keyof typeof mockSettings]
    );
    mockSettingsService.set.mockReturnValue({ success: true });
    mockSettingsService.getOptions.mockImplementation((key: string) => {
      if (key === "theme") return ["default", "minimal", "colorful"];
      if (key === "defaultProfile") return ["default", "dev"];
      return undefined;
    });
    mockClientService.detectClients.mockReturnValue([
      {
        id: "claude",
        name: "Claude Desktop",
        configPath: "/path/to/claude/config.json",
        installed: true,
        hasConfig: true,
        status: "connected",
        serverCount: 2,
      },
      {
        id: "cursor",
        name: "Cursor",
        configPath: null,
        installed: true,
        hasConfig: false,
        status: "disconnected",
        serverCount: 0,
      },
    ]);
    mockConfigService.getPaths.mockReturnValue({
      configDir: "/tmp/test",
      configPath: "/tmp/test/config.json",
    });
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never);
  });

  describe("Rendering", () => {
    it("should render settings screen with title", () => {
      const { lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Settings");
    });

    it("should display settings keys and values", () => {
      const { lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("autoTest");
      expect(lastFrame()).toContain("theme");
      expect(lastFrame()).toContain("logLevel");
    });

    it("should display current values", () => {
      const { lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toMatch(/true|dark|info/);
    });

    it("should show settings descriptions", () => {
      const { lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      expect(lastFrame()).toMatch(/Auto test|UI theme|Log level/i);
    });
  });

  describe("Navigation", () => {
    it("should call onBack when Q is pressed", () => {
      const { stdin } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write("q");

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should call onBack when ESC is pressed", () => {
      const { stdin } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ESCAPE);

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should navigate between settings with arrow keys", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      const initialFrame = lastFrame();
      expect(initialFrame).toContain("→");

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("→");
    });
  });

  describe("Reset Settings", () => {
    it("should show reset confirmation when R is pressed", async () => {
      const { lastFrame, stdin } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write("r");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Reset Settings");
      expect(lastFrame()).toContain("Reset all settings to defaults");
    });

    it("should cancel reset when N is pressed", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      // Show reset dialog
      stdin.write("r");
      await waitForStateUpdate();

      // Cancel reset
      stdin.write("n");
      await waitForStateUpdate();

      // Should be back to settings list
      expect(lastFrame()).toContain("Settings");
      expect(mockSettingsService.reset).not.toHaveBeenCalled();
    });

    it("should reset settings when confirmed with Y", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write("r");
      await waitForStateUpdate();
      stdin.write("Y");
      await waitForStateUpdate();

      expect(mockSettingsService.reset).toHaveBeenCalled();
      expect(lastFrame()).toContain("Settings reset to defaults");
    });
  });

  describe("Edit Setting", () => {
    it("should show edit view when Enter is pressed", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // Should show edit interface
      expect(lastFrame()).toMatch(/value|select|toggle/i);
    });

    it("should toggle boolean settings with Space", async () => {
      const { stdin } = render(<SettingsScreen onBack={mockOnBack} />);

      // First setting (autoTest) is boolean
      stdin.write(KEYS.SPACE);
      await waitForStateUpdate();

      expect(mockSettingsService.set).toHaveBeenCalledWith("autoTest", false);
    });

    it("should cycle settings with known options", async () => {
      const { stdin } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockSettingsService.set).toHaveBeenCalledWith("theme", "minimal");
    });

    it("should edit the port and reconnect connected clients", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} initialKey="port" />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Edit Setting");

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockSettingsService.set).toHaveBeenCalledWith("port", "8850");
      expect(mockClientService.detectClients).toHaveBeenCalled();
      expect(mockClientService.disconnectClient).toHaveBeenCalledWith("claude");
      expect(mockClientService.connectClient).toHaveBeenCalledWith("claude");
      expect(mockClientService.disconnectClient).not.toHaveBeenCalledWith("cursor");
    });

    it("should show an error message when saving a setting fails", async () => {
      mockSettingsService.set.mockReturnValueOnce({
        success: false,
        error: "invalid value",
      });

      const { stdin, lastFrame } = render(
        <SettingsScreen onBack={mockOnBack} initialKey="logLevel" />
      );

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("invalid value");
    });
  });

  describe("Config Actions", () => {
    it("should display the config path when C is pressed", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write("c");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Config: /tmp/test/config.json");
    });

    it("should open the config file using the configured editor", async () => {
      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write("o");
      await waitForStateUpdate();

      expect(spawnSync).toHaveBeenCalledWith("vi", ["/tmp/test/config.json"], {
        stdio: "ignore",
      });
      expect(lastFrame()).toContain("Opened /tmp/test/config.json in vi");
    });

    it("should show an error when opening the config file throws", async () => {
      vi.mocked(spawnSync).mockImplementationOnce(() => {
        throw new Error("no editor");
      });

      const { stdin, lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      stdin.write("o");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Failed to open /tmp/test/config.json");
    });
  });

  describe("Help Text", () => {
    it("should display keyboard shortcuts", () => {
      const { lastFrame } = render(<SettingsScreen onBack={mockOnBack} />);

      const frame = lastFrame();
      expect(frame).toMatch(/R.*Reset|Reset/i);
      expect(frame).toMatch(/Q|Back/i);
    });
  });
});
