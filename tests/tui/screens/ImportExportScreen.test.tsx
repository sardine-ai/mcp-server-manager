/**
 * ImportExportScreen Tests
 */

import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "../setup.js";
import { mockImportExportService, mockClientService, waitForStateUpdate, KEYS } from "../setup.js";

// Setup mocks before importing component
vi.mock("../../../src/services/import-export.service.js", () => ({
  getImportExportService: vi.fn(() => mockImportExportService),
}));

vi.mock("../../../src/services/client.service.js", () => ({
  getClientService: vi.fn(() => mockClientService),
}));

import { ImportExportScreen } from "../../../src/tui/screens/ImportExportScreen.js";

const importedServer = {
  id: "imported",
  name: "Imported Server",
  serverType: "local" as const,
  command: "node",
  args: [],
};

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

describe("ImportExportScreen", () => {
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
    mockImportExportService.importFromFile.mockReturnValue({
      success: true,
      servers: [importedServer],
      format: "mcpsm",
    });
    mockImportExportService.importFromClient.mockReturnValue({
      success: true,
      servers: [importedServer],
      format: "claude",
    });
    mockImportExportService.detectConflicts.mockReturnValue({
      conflicts: [],
      noConflicts: [importedServer],
      totalConflicts: 0,
    });
    mockImportExportService.mergeServersWithDecisions.mockReturnValue({
      added: 1,
      updated: 0,
      skipped: 0,
      merged: 0,
    });
    mockImportExportService.exportToFile.mockReturnValue({ success: true });
    mockImportExportService.export.mockReturnValue({
      servers: [importedServer],
      remoteServers: [],
    });
  });

  describe("Rendering", () => {
    it("should render import/export screen with title", () => {
      const { lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Import / Export");
    });

    it("should display import options", () => {
      const { lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Import from File");
    });

    it("should display export options", () => {
      const { lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Export to File");
      expect(lastFrame()).toContain("Show Export");
    });

    it("should display client import options for installed clients", () => {
      const { lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Import from Claude Desktop");
    });
  });

  describe("Navigation", () => {
    it("should call onBack when Q is pressed", () => {
      const { stdin } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write("q");

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should call onBack when ESC is pressed", () => {
      const { stdin } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ESCAPE);

      expect(mockOnBack).toHaveBeenCalled();
    });

    it("should navigate between options with arrow keys", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      const initialFrame = lastFrame();
      expect(initialFrame).toContain("→");

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("→");
    });
  });

  describe("Import from File", () => {
    it("should show file path input when Import from File is selected", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Enter file path");
    });

    it("should cancel import with ESC", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      // Select Import from File
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      // Press ESC
      stdin.write(KEYS.ESCAPE);
      await waitForStateUpdate();

      // Should be back at menu
      expect(lastFrame()).toContain("Import from File");
    });

    it("should preview and confirm imported servers from a file", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      await submitInput(stdin, "/tmp/servers.json");

      expect(mockImportExportService.importFromFile).toHaveBeenCalledWith("/tmp/servers.json");
      expect(lastFrame()).toContain("Found 1 server");
      expect(lastFrame()).toContain("Imported Server");

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockImportExportService.mergeServersWithDecisions).toHaveBeenCalledWith(
        [importedServer],
        expect.any(Map)
      );
      expect(lastFrame()).toContain("Import completed");
      expect(lastFrame()).toContain("Added: 1");
    });

    it("should show an import error result", async () => {
      mockImportExportService.importFromFile.mockReturnValueOnce({
        success: false,
        error: "bad json",
      });

      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      await submitInput(stdin, "/tmp/bad.json");

      expect(lastFrame()).toContain("bad json");
    });

    it("should report when an import file has no servers", async () => {
      mockImportExportService.importFromFile.mockReturnValueOnce({
        success: true,
        servers: [],
        format: "mcpsm",
      });

      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      await submitInput(stdin, "/tmp/empty.json");

      expect(lastFrame()).toContain("No servers found in file");
    });

    it("should resolve import conflicts with a per-server decision", async () => {
      mockImportExportService.detectConflicts.mockReturnValueOnce({
        conflicts: [
          {
            id: "imported",
            name: "Imported Server",
            type: "local",
            existing: { id: "imported", name: "Old", command: "node", args: [] },
            incoming: importedServer,
            differences: [
              {
                field: "name",
                existing: "Old",
                incoming: "Imported Server",
              },
            ],
          },
        ],
        noConflicts: [],
        totalConflicts: 1,
      });
      mockImportExportService.mergeServersWithDecisions.mockReturnValueOnce({
        added: 0,
        updated: 1,
        skipped: 0,
        merged: 0,
      });

      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      await submitInput(stdin, "/tmp/conflict.json");

      expect(lastFrame()).toContain("Resolve Conflicts");
      expect(lastFrame()).toContain("Imported Server");

      stdin.write("o");
      await waitForStateUpdate();

      expect(mockImportExportService.mergeServersWithDecisions).toHaveBeenCalledWith(
        [importedServer],
        expect.any(Map)
      );
      const decisions = mockImportExportService.mergeServersWithDecisions.mock.calls[0][1] as Map<
        string,
        string
      >;
      expect(decisions.get("imported")).toBe("overwrite");
      expect(lastFrame()).toContain("Updated: 1");
    });
  });

  describe("Import from Client", () => {
    it("should import from client when client option is selected", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      // Navigate to Claude Desktop import option (second option)
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      // Select
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();

      expect(mockImportExportService.importFromClient).toHaveBeenCalledWith("claude");
      expect(lastFrame()).toContain("Found 1 server");
    });
  });

  describe("Export Options", () => {
    it("should show export options in menu", () => {
      const { lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      expect(lastFrame()).toContain("Export to File");
      expect(lastFrame()).toContain("Show Export");
    });

    it("should navigate through menu options", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      // Navigate down
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();

      // Should still show menu with selection
      expect(lastFrame()).toContain("→");
    });

    it("should export selected format to a file", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Select Export Format");

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      expect(lastFrame()).toContain("Enter output file path");

      await submitInput(stdin, "/tmp/out.json");

      expect(mockImportExportService.exportToFile).toHaveBeenCalledWith("/tmp/out.json", "mcpsm");
      expect(lastFrame()).toContain("Exported to /tmp/out.json");
    });

    it("should show exported JSON in the result view", async () => {
      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.DOWN);
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      stdin.write(KEYS.ENTER);
      await waitForStateUpdate(300);

      expect(mockImportExportService.export).toHaveBeenCalledWith("mcpsm");
      expect(lastFrame()).toContain("Export (mcpsm)");
      expect(lastFrame()).toContain("Imported Server");
    });

    it("should return to the menu after a result keypress", async () => {
      mockImportExportService.importFromFile.mockReturnValueOnce({
        success: false,
        error: "bad json",
      });

      const { stdin, lastFrame } = render(<ImportExportScreen onBack={mockOnBack} />);

      stdin.write(KEYS.ENTER);
      await waitForStateUpdate();
      await submitInput(stdin, "/tmp/bad.json");
      expect(lastFrame()).toContain("bad json");

      stdin.write("x");
      await waitForStateUpdate();

      expect(lastFrame()).toContain("Import from File");
    });
  });
});
