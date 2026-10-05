import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  ImportExportService,
  resetImportExportService,
} from "../src/services/import-export.service.js";
import { getConfigService, resetConfigService } from "../src/services/config.service.js";
import type { ConfigService } from "../src/services/config.service.js";
import { resetClientService } from "../src/services/client.service.js";

// Test directory setup
const testConfigDir = path.join(os.tmpdir(), "mcpsm-import-export-test-" + Date.now());

describe("ImportExportService", () => {
  let importExportService: ImportExportService;
  let configService: ConfigService;

  beforeEach(() => {
    process.env.MCP_MANAGER_CONFIG_DIR = testConfigDir;
    resetConfigService();
    resetClientService();
    resetImportExportService();

    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Write default config
    fs.writeFileSync(
      path.join(testConfigDir, "config.json"),
      JSON.stringify({
        servers: [{ id: "existing-local", name: "Existing Local", command: "node", args: [] }],
        remoteServers: [
          {
            id: "existing-remote",
            name: "Existing Remote",
            type: "http",
            url: "http://localhost:3000",
          },
        ],
        port: 8850,
      })
    );

    configService = getConfigService(testConfigDir);
    importExportService = new ImportExportService();
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    resetImportExportService();
    resetClientService();
    resetConfigService();
  });

  describe("parseImportData", () => {
    it("should parse Claude Desktop format with local servers", () => {
      const claudeConfig = {
        mcpServers: {
          "test-server": {
            command: "npx",
            args: ["-y", "test-package"],
          },
          "another-server": {
            command: "node",
            args: ["server.js"],
            env: { API_KEY: "secret" },
          },
        },
      };

      const result = importExportService.parseImportData(claudeConfig);
      expect(result?.format).toBe("claude");
      expect(result?.servers).toHaveLength(2);
      expect(result?.servers[0].id).toBe("test-server");
      expect(result?.servers[0].command).toBe("npx");
      expect(result?.servers[0].args).toEqual(["-y", "test-package"]);
      expect(result?.servers[1].env).toEqual({ API_KEY: "secret" });
    });

    it("should parse Claude format with remote servers", () => {
      const claudeConfig = {
        mcpServers: {
          "remote-test": {
            url: "https://api.example.com/mcp",
            bearerToken: "token123",
          },
        },
      };

      const result = importExportService.parseImportData(claudeConfig);
      expect(result?.format).toBe("claude");
      expect(result?.servers[0].serverType).toBe("remote");
      expect(result?.servers[0].url).toBe("https://api.example.com/mcp");
      expect(result?.servers[0].bearerToken).toBe("token123");
    });

    it("should parse remote serverUrl and headers from JSON configs", () => {
      const claudeConfig = {
        mcpServers: {
          devin: {
            serverUrl: "https://mcp.devin.ai/mcp",
            headers: {
              Authorization: "Bearer devin-token",
              "X-Org-Id": "org_JVU8h2dxO575yI66",
            },
          },
        },
      };

      const result = importExportService.parseImportData(claudeConfig);
      expect(result?.format).toBe("claude");
      expect(result?.servers[0].serverType).toBe("remote");
      expect(result?.servers[0].url).toBe("https://mcp.devin.ai/mcp");
      expect(result?.servers[0].headers).toEqual({
        Authorization: "Bearer devin-token",
        "X-Org-Id": "org_JVU8h2dxO575yI66",
      });
    });

    it("should parse MCPSM format with servers and remoteServers", () => {
      const mcpsmConfig = {
        servers: [{ id: "local1", name: "Local 1", command: "npx", args: [] }],
        remoteServers: [{ id: "remote1", name: "Remote 1", type: "http", url: "http://localhost" }],
      };

      const result = importExportService.parseImportData(mcpsmConfig);
      expect(result?.format).toBe("mcpsm");
      expect(result?.servers).toHaveLength(2);
      expect(result?.servers[0].serverType).toBe("local");
      expect(result?.servers[1].serverType).toBe("remote");
    });

    it("should parse array format", () => {
      const arrayConfig = [
        { id: "server1", name: "Server 1", command: "npx" },
        { id: "server2", url: "http://localhost:3000" },
      ];

      const result = importExportService.parseImportData(arrayConfig);
      expect(result?.format).toBe("array");
      expect(result?.servers).toHaveLength(2);
      expect(result?.servers[0].serverType).toBe("local");
      expect(result?.servers[1].serverType).toBe("remote");
    });

    it("should return null for unknown format", () => {
      const unknownConfig = { randomKey: "randomValue" };
      const result = importExportService.parseImportData(unknownConfig);
      expect(result).toBeNull();
    });

    it("should return null for empty object", () => {
      const result = importExportService.parseImportData({});
      expect(result).toBeNull();
    });
  });

  describe("importFromFile", () => {
    it("should import from valid Claude format file", () => {
      const importFile = path.join(testConfigDir, "import.json");
      fs.writeFileSync(
        importFile,
        JSON.stringify({
          mcpServers: {
            "imported-server": { command: "node", args: ["test.js"] },
          },
        })
      );

      const result = importExportService.importFromFile(importFile);
      expect(result.success).toBe(true);
      expect(result.format).toBe("claude");
      expect(result.servers).toHaveLength(1);
      expect(result.servers?.[0].id).toBe("imported-server");
    });

    it("should return error for non-existent file", () => {
      const result = importExportService.importFromFile("/nonexistent/path/file.json");
      expect(result.success).toBe(false);
      expect(result.error).toBe("File not found");
    });

    it("should return error for invalid JSON", () => {
      const importFile = path.join(testConfigDir, "invalid.json");
      fs.writeFileSync(importFile, "not valid json");

      const result = importExportService.importFromFile(importFile);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should return error for unknown format", () => {
      const importFile = path.join(testConfigDir, "unknown.json");
      fs.writeFileSync(importFile, JSON.stringify({ someRandomKey: true }));

      const result = importExportService.importFromFile(importFile);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown format");
    });
  });

  describe("mergeServers", () => {
    it("should add new local servers", () => {
      const servers = [
        {
          id: "new-local",
          name: "New Local",
          command: "npx",
          args: ["-y", "test"],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.mergeServers(servers);
      expect(result.added).toBe(1);
      expect(result.skipped).toBe(0);

      const newConfig = configService.getConfig();
      expect(newConfig.servers.find((s) => s.id === "new-local")).toBeDefined();
    });

    it("should add new remote servers", () => {
      const servers = [
        {
          id: "new-remote",
          name: "New Remote",
          url: "http://localhost:4000",
          serverType: "remote" as const,
        },
      ];

      const result = importExportService.mergeServers(servers);
      expect(result.added).toBe(1);

      const newConfig = configService.getConfig();
      expect(newConfig.remoteServers.find((s) => s.id === "new-remote")).toBeDefined();
    });

    it("should add new remote servers with custom headers", () => {
      const servers = [
        {
          id: "devin",
          name: "devin",
          url: "https://mcp.devin.ai/mcp",
          serverType: "remote" as const,
          headers: {
            "X-Org-Id": "org_JVU8h2dxO575yI66",
          },
        },
      ];

      const result = importExportService.mergeServers(servers);
      expect(result.added).toBe(1);

      const added = configService.findRemoteServer("devin");
      expect(added?.headers).toEqual({
        "X-Org-Id": "org_JVU8h2dxO575yI66",
      });
    });

    it("should skip existing servers without overwrite", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Different Name",
          command: "python",
          args: [],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.mergeServers(servers);
      expect(result.skipped).toBe(1);
      expect(result.added).toBe(0);
    });

    it("should update existing servers with overwrite option", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Updated Name",
          command: "python",
          args: ["new.py"],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.mergeServers(servers, { overwrite: true });
      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);

      const updated = configService.findLocalServer("existing-local");
      expect(updated?.command).toBe("python");
      expect(updated?.name).toBe("Updated Name");
    });

    it("should handle mixed local and remote servers", () => {
      const servers = [
        {
          id: "new-local-1",
          name: "Local 1",
          command: "npx",
          serverType: "local" as const,
        },
        {
          id: "new-remote-1",
          name: "Remote 1",
          url: "http://localhost:5000",
          serverType: "remote" as const,
        },
        {
          id: "existing-local",
          name: "Skip",
          command: "skip",
          serverType: "local" as const,
        },
      ];

      const result = importExportService.mergeServers(servers);
      expect(result.added).toBe(2);
      expect(result.skipped).toBe(1);
    });
  });

  describe("exportToMcpsmFormat", () => {
    it("should export all servers in MCPSM format", () => {
      const result = importExportService.exportToMcpsmFormat();
      expect(result.servers).toBeInstanceOf(Array);
      expect(result.remoteServers).toBeInstanceOf(Array);
      expect(result.port).toBe(8850);
    });

    it("should include all server properties", () => {
      const result = importExportService.exportToMcpsmFormat();
      const local = result.servers.find((s) => s.id === "existing-local");
      expect(local).toHaveProperty("id");
      expect(local).toHaveProperty("name");
      expect(local).toHaveProperty("command");
      expect(local).toHaveProperty("args");
    });

    it("should export remote server headers in MCPSM format", () => {
      configService.addRemoteServer({
        id: "devin",
        name: "devin",
        type: "http",
        url: "https://mcp.devin.ai/mcp",
        headers: {
          "X-Org-Id": "org_JVU8h2dxO575yI66",
        },
      });

      const result = importExportService.exportToMcpsmFormat();
      const devin = result.remoteServers.find((server) => server.id === "devin");

      expect(devin?.headers).toEqual({
        "X-Org-Id": "org_JVU8h2dxO575yI66",
      });
    });
  });

  describe("export", () => {
    it("should export in MCPSM format by default", () => {
      const result = importExportService.export() as {
        servers: unknown[];
        remoteServers: unknown[];
      };
      expect(result).toHaveProperty("servers");
      expect(result).toHaveProperty("remoteServers");
    });
  });

  describe("exportToFile", () => {
    it("should write export to file", () => {
      const outputFile = path.join(testConfigDir, "exported.json");

      const result = importExportService.exportToFile(outputFile);
      expect(result.success).toBe(true);
      expect(fs.existsSync(outputFile)).toBe(true);

      const content = JSON.parse(fs.readFileSync(outputFile, "utf8"));
      expect(content).toHaveProperty("servers");
    });
  });

  describe("detectConflicts", () => {
    it("should detect local server conflicts by ID", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Updated Name",
          command: "python",
          args: ["new.py"],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.detectConflicts(servers);
      expect(result.totalConflicts).toBe(1);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].id).toBe("existing-local");
      expect(result.noConflicts).toHaveLength(0);
    });

    it("should detect remote server conflicts by ID", () => {
      const servers = [
        {
          id: "existing-remote",
          name: "Updated Remote",
          url: "http://localhost:5000",
          type: "http" as const,
          serverType: "remote" as const,
        },
      ];

      const result = importExportService.detectConflicts(servers);
      expect(result.totalConflicts).toBe(1);
      expect(result.conflicts[0].id).toBe("existing-remote");
    });

    it("should identify differences between existing and incoming servers", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Different Name",
          command: "python",
          args: ["different.py"],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.detectConflicts(servers);
      const conflict = result.conflicts[0];

      // Should have differences
      expect(conflict.differences.length).toBeGreaterThan(0);

      // Check for specific differences
      const commandDiff = conflict.differences.find((d) => d.field === "command");
      expect(commandDiff).toBeDefined();
      expect(commandDiff?.existing).toBe("node");
      expect(commandDiff?.incoming).toBe("python");
    });

    it("should auto-skip when servers are identical", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Existing Local",
          command: "node",
          args: [],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.detectConflicts(servers);

      // Should NOT report as conflict (identical servers auto-skip)
      expect(result.totalConflicts).toBe(0);
      expect(result.conflicts).toHaveLength(0);
      // Should be in noConflicts instead
      expect(result.noConflicts).toHaveLength(1);
      expect(result.noConflicts[0].id).toBe("existing-local");
    });

    it("should separate non-conflicting servers", () => {
      const servers = [
        {
          id: "new-local",
          name: "New Local",
          command: "npx",
          args: ["-y", "test"],
          serverType: "local" as const,
        },
        {
          id: "existing-local",
          name: "Conflict",
          command: "python",
          args: [],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.detectConflicts(servers);
      expect(result.totalConflicts).toBe(1);
      expect(result.noConflicts).toHaveLength(1);
      expect(result.noConflicts[0].id).toBe("new-local");
    });

    it("should detect env variable differences", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Existing Local",
          command: "node",
          args: [],
          env: { NEW_VAR: "value" },
          serverType: "local" as const,
        },
      ];

      const result = importExportService.detectConflicts(servers);
      const envDiff = result.conflicts[0].differences.find((d) => d.field === "env");
      expect(envDiff).toBeDefined();
      expect(envDiff?.isDifferent).toBe(true);
    });
  });

  describe("mergeServersWithDecisions", () => {
    it("should skip servers when decision is skip", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Updated",
          command: "python",
          args: [],
          serverType: "local" as const,
        },
      ];

      const decisions = new Map([["existing-local", "skip" as const]]);
      const result = importExportService.mergeServersWithDecisions(servers, decisions);

      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.merged).toBe(0);

      // Verify server was not updated
      const server = configService.findLocalServer("existing-local");
      expect(server?.name).toBe("Existing Local"); // unchanged
    });

    it("should overwrite servers when decision is overwrite", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Updated Name",
          command: "python",
          args: ["new.py"],
          serverType: "local" as const,
        },
      ];

      const decisions = new Map([["existing-local", "overwrite" as const]]);
      const result = importExportService.mergeServersWithDecisions(servers, decisions);

      expect(result.updated).toBe(1);
      expect(result.skipped).toBe(0);

      // Verify server was updated
      const server = configService.findLocalServer("existing-local");
      expect(server?.name).toBe("Updated Name");
      expect(server?.command).toBe("python");
    });

    it("should merge servers intelligently when decision is merge", () => {
      const servers = [
        {
          id: "existing-local",
          name: "Existing Local",
          command: "python",
          args: ["test.py"],
          env: { NEW_VAR: "new_value" },
          serverType: "local" as const,
        },
      ];

      const decisions = new Map([["existing-local", "merge" as const]]);
      const result = importExportService.mergeServersWithDecisions(servers, decisions);

      expect(result.merged).toBe(1);
      expect(result.updated).toBe(0);

      // Verify server was merged (command updated, env merged)
      const server = configService.findLocalServer("existing-local");
      expect(server?.command).toBe("python"); // from incoming
      expect(server?.env?.NEW_VAR).toBe("new_value"); // from incoming
    });

    it("should add new servers when they don't conflict", () => {
      const servers = [
        {
          id: "new-local",
          name: "New Server",
          command: "npx",
          args: ["-y", "test"],
          serverType: "local" as const,
        },
      ];

      const result = importExportService.mergeServersWithDecisions(servers, new Map());
      expect(result.added).toBe(1);

      const server = configService.findLocalServer("new-local");
      expect(server).toBeDefined();
      expect(server?.name).toBe("New Server");
    });

    it("should handle multiple servers with different decisions", () => {
      const servers = [
        {
          id: "existing-local",
          name: "To Skip",
          command: "python",
          args: [],
          serverType: "local" as const,
        },
        {
          id: "existing-remote",
          name: "To Overwrite",
          url: "http://localhost:5000",
          type: "http" as const,
          serverType: "remote" as const,
        },
        {
          id: "new-local",
          name: "To Add",
          command: "node",
          args: [],
          serverType: "local" as const,
        },
      ];

      const decisions = new Map([
        ["existing-local", "skip" as const],
        ["existing-remote", "overwrite" as const],
      ]);

      const result = importExportService.mergeServersWithDecisions(servers, decisions);
      expect(result.skipped).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.added).toBe(1);
    });

    it("should handle remote server merging", () => {
      const servers = [
        {
          id: "existing-remote",
          name: "Updated Remote",
          url: "http://localhost:5000",
          type: "http" as const,
          bearerToken: "new-token",
          serverType: "remote" as const,
        },
      ];

      const decisions = new Map([["existing-remote", "merge" as const]]);
      const result = importExportService.mergeServersWithDecisions(servers, decisions);

      expect(result.merged).toBe(1);

      const server = configService.findRemoteServer("existing-remote");
      expect(server?.url).toBe("http://localhost:5000"); // from incoming
      expect(server?.bearerToken).toBe("new-token"); // from incoming
    });
  });
});
