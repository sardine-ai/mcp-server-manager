import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportExportService } from "../src/services/import-export.service.js";

const mockConfigService = {
  findLocalServer: vi.fn(),
  findRemoteServer: vi.fn(),
  addLocalServer: vi.fn(() => ({ success: true })),
  addRemoteServer: vi.fn(() => ({ success: true })),
  updateLocalServer: vi.fn(() => ({ success: true })),
  updateRemoteServer: vi.fn(() => ({ success: true })),
};

const mockClientService = {
  readClientConfig: vi.fn(),
};

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof mockConfigService => mockConfigService,
}));

vi.mock("../src/services/client.service.js", () => ({
  getClientService: (): typeof mockClientService => mockClientService,
}));

describe("ImportExportService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockConfigService.addLocalServer.mockReturnValue({ success: true });
    mockConfigService.addRemoteServer.mockReturnValue({ success: true });
    mockConfigService.updateLocalServer.mockReturnValue({ success: true });
    mockConfigService.updateRemoteServer.mockReturnValue({ success: true });
  });

  it.each([false, true])(
    "reports rejected and thrown writes through both entry points (%s)",
    (decisions) => {
      mockConfigService.addLocalServer.mockReturnValueOnce({ success: false });
      mockConfigService.addRemoteServer.mockImplementationOnce(() => {
        throw new Error("write failed");
      });
      const service = new ImportExportService();
      const servers = [
        { id: "rejected", name: "Rejected", serverType: "local" as const, command: "node" },
        {
          id: "throws",
          name: "Throws",
          serverType: "remote" as const,
          url: "http://localhost/mcp",
        },
        { id: "saved", name: "Saved", serverType: "local" as const, command: "node" },
      ];
      const result = decisions
        ? service.mergeServersWithDecisions(servers)
        : service.mergeServers(servers);
      expect(result).toMatchObject({
        added: 1,
        updated: 0,
        skipped: 0,
        merged: 0,
        errors: [
          { serverId: "rejected", error: "Import failed" },
          { serverId: "throws", error: "write failed" },
        ],
      });
    }
  );

  it("parses mcpsm formatted payloads with local and remote servers", () => {
    const service = new ImportExportService();
    const parsed = service.parseImportData({
      servers: [{ id: "local1", name: "Local", command: "node", args: [] }],
      remoteServers: [{ id: "remote1", name: "Remote", url: "http://localhost", type: "http" }],
    });

    expect(parsed?.format).toBe("mcpsm");
    expect(parsed?.servers).toHaveLength(2);
    expect(parsed?.servers?.find((s) => s.serverType === "remote")?.url).toBe("http://localhost");
  });

  it("detects conflicts when incoming servers differ from existing ones", () => {
    const service = new ImportExportService();
    mockConfigService.findLocalServer.mockReturnValue({
      id: "local1",
      name: "Existing",
      command: "old",
      args: [],
      disabled: false,
    });

    const conflicts = service.detectConflicts([
      {
        id: "local1",
        name: "Incoming",
        serverType: "local",
        command: "new",
        args: [],
      },
    ]);

    expect(conflicts.conflicts).toHaveLength(1);
    expect(conflicts.noConflicts).toHaveLength(0);
  });

  it("merges local servers with decisions and combines environment variables", () => {
    const service = new ImportExportService();
    mockConfigService.findLocalServer.mockReturnValue({
      id: "local1",
      name: "Existing",
      command: "old",
      args: ["--old"],
      env: { FOO: "1" },
    });

    const decisions = new Map([["local1", "merge" as const]]);
    const result = service.mergeServersWithDecisions(
      [
        {
          id: "local1",
          name: "Incoming",
          serverType: "local",
          command: "new",
          args: ["--new"],
          env: { BAR: "2" },
        },
      ],
      decisions
    );

    expect(result.merged).toBe(1);
    expect(mockConfigService.updateLocalServer).toHaveBeenCalledWith(
      "local1",
      expect.objectContaining({
        name: "Incoming",
        command: "new",
        args: ["--new"],
        env: { FOO: "1", BAR: "2" },
      })
    );
  });
});
