import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { getConfigService, resetConfigService } from "../src/services/config.service.js";
import { resetClientService } from "../src/services/client.service.js";
import {
  ImportExportService,
  resetImportExportService,
} from "../src/services/import-export.service.js";
import type { ConfigService } from "../src/services/config.service.js";

// Test directory setup
const testConfigDir = path.join(os.tmpdir(), "mcpsm-batch-import-test-" + Date.now());
const testDataDir = path.join(os.tmpdir(), "mcpsm-import-data-" + Date.now());
let importFile: string;

describe("Batch MCP Import (CLI/TUI Parity)", () => {
  let configService: ConfigService;
  let importExportService: ImportExportService;

  beforeEach(() => {
    process.env.MCP_MANAGER_CONFIG_DIR = testConfigDir;
    resetConfigService();
    resetClientService();
    resetImportExportService();

    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    if (!fs.existsSync(testDataDir)) {
      fs.mkdirSync(testDataDir, { recursive: true });
    }

    // Create the import file with MCP servers data
    importFile = path.join(testDataDir, "mcp-servers.json");
    const fixtureContent = fs.readFileSync(
      path.resolve("./tests/fixtures/redacted-mcp-servers.json"),
      "utf8"
    );
    fs.writeFileSync(importFile, fixtureContent);

    // Initialize with empty config
    fs.writeFileSync(
      path.join(testConfigDir, "config.json"),
      JSON.stringify({
        servers: [],
        remoteServers: [],
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
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
    resetImportExportService();
    resetClientService();
    resetConfigService();
  });

  describe("Import from temporary MCP servers file", () => {
    it("should load the import file", () => {
      expect(fs.existsSync(importFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(importFile, "utf8"));
      expect(content).toHaveProperty("servers");
      expect(content).toHaveProperty("remoteServers");
      expect(content.servers.length).toBeGreaterThan(0);
      expect(content.remoteServers.length).toBeGreaterThan(0);
    });

    it("should parse the MCP servers file correctly", () => {
      const result = importExportService.importFromFile(importFile);
      expect(result.success).toBe(true);
      expect(result.format).toBe("mcpsm");
      expect(result.servers).toBeDefined();
      expect(result.servers.length).toBe(24);
    });

    it("should identify correct server types (local vs remote)", () => {
      const result = importExportService.importFromFile(importFile);
      expect(result.servers).toBeDefined();

      const localServers = result.servers.filter((s) => s.serverType === "local");
      const remoteServers = result.servers.filter((s) => s.serverType === "remote");

      // Verify we have both types
      expect(localServers.length).toBeGreaterThan(0);
      expect(remoteServers.length).toBeGreaterThan(0);

      // Local servers should have command
      localServers.forEach((s) => {
        expect(s.command).toBeDefined();
      });

      // Remote servers should have URL
      remoteServers.forEach((s) => {
        expect(s.url).toBeDefined();
      });
    });

    it("should import all servers with correct configuration", () => {
      const result = importExportService.importFromFile(importFile);
      const mergeResult = importExportService.mergeServersWithDecisions(
        result.servers || [],
        new Map()
      );

      expect(mergeResult.added).toBe(24);
      expect(mergeResult.skipped).toBe(0);

      const config = configService.getConfig();
      expect(config.servers.length + config.remoteServers.length).toBe(24);
    });

    it("should import all servers successfully", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      const config = configService.getConfig();
      const allServers = [
        ...config.servers.map((s) => ({ ...s, type: "local" as const })),
        ...config.remoteServers.map((s) => ({ ...s, type: "remote" as const })),
      ];

      expect(allServers.length).toBeGreaterThan(0);
    });

    it("should handle specific known servers from the import file", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      // Check specific servers
      const deepwiki = configService.findRemoteServer("deepwiki");
      expect(deepwiki).toBeDefined();
      expect(deepwiki?.url).toBe("https://mcp.deepwiki.com/mcp");
      const postmanFull = configService.findRemoteServer("postman-full");
      expect(postmanFull).toBeDefined();
      expect(postmanFull?.bearerToken).toBeDefined();

      const filesystem = configService.findLocalServer("filesystem");
      expect(filesystem).toBeDefined();
      expect(filesystem?.command).toBe("npx");
    });

    it("should preserve authentication tokens during import", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      // postman-full should have bearer token
      const postman = configService.findRemoteServer("postman-full");
      expect(postman?.bearerToken).toBe("REDACTED");

      // devin should have bearer token (SSE)
      const devin = configService.findRemoteServer("devin");
      expect(devin?.bearerToken).toBe("REDACTED");
      const postmanMinimal = configService.findRemoteServer("postman-minimal");
      expect(postmanMinimal?.bearerToken).toBe("REDACTED");
    });

    it("should preserve environment variables for local servers", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      // brave-search should have BRAVE_API_KEY
      const braveSearch = configService.findLocalServer("brave-search");
      expect(braveSearch?.env?.BRAVE_API_KEY).toBe("REDACTED");

      const metamcp = configService.findLocalServer("metamcp");
      expect(metamcp?.env?.API_ACCESS_TOKEN).toBe("REDACTED");

      // sardineInternalSandbox should keep path
      const sardineInternalSandbox = configService.findLocalServer("sardineinternalsandbox");
      expect(sardineInternalSandbox?.env?.GOOGLE_APPLICATION_CREDENTIALS).toBe(
        "~/.config/gcloud/application_default_credentials.json"
      );
    });

    it("should handle different server types (STDIO, HTTP, SSE)", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      const config = configService.getConfig();

      // Check for different types in remote servers
      const remoteServers = config.remoteServers;

      // Should have HTTP servers
      const httpServers = remoteServers.filter((s) => s.type === "http");
      expect(httpServers.length).toBeGreaterThan(0);

      // Should have SSE servers
      const sseServers = remoteServers.filter((s) => s.type === "sse");
      expect(sseServers.length).toBeGreaterThan(0);

      // Should have local STDIO servers
      const localServers = config.servers;
      expect(localServers.length).toBeGreaterThan(0);
      localServers.forEach((s) => {
        expect(s.command).toBeDefined();
      });
    });
  });

  describe("TUI Rendering - Server List Checkbox", () => {
    it("should export config that renders correctly in TUI", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      const exported = importExportService.export();
      expect(exported).toHaveProperty("servers");
      expect(exported).toHaveProperty("remoteServers");

      const allServers = [
        ...(Array.isArray(exported.servers) ? exported.servers : []),
        ...(Array.isArray(exported.remoteServers) ? exported.remoteServers : []),
      ];

      allServers.forEach((server: any) => {
        expect(server).toHaveProperty("id");
        expect(server).toHaveProperty("name");
      });
    });
  });

  describe("CLI/TUI Parity", () => {
    it("should import same way via CLI and programmatically", () => {
      // Programmatic import
      const result = importExportService.importFromFile(importFile);
      const mergeResult = importExportService.mergeServersWithDecisions(
        result.servers || [],
        new Map()
      );

      // Verify the result matches expectations
      expect(mergeResult.added).toBe(24);
      expect(mergeResult.skipped).toBe(0);
      expect(mergeResult.updated).toBe(0);
      expect(mergeResult.merged).toBe(0);

      // Check that config is properly stored
      const config = configService.getConfig();
      expect(config.servers.length + config.remoteServers.length).toBe(24);
    });

    it("should maintain consistent state across reads", () => {
      // Import servers
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      // First read
      const config1 = configService.getConfig();
      const totalCount1 = config1.servers.length + config1.remoteServers.length;

      // Reset and read again (simulating CLI reading the config)
      resetConfigService();
      const config2 = getConfigService(testConfigDir).getConfig();
      const totalCount2 = config2.servers.length + config2.remoteServers.length;

      // Should be consistent
      expect(totalCount1).toBe(totalCount2);
      expect(totalCount1).toBe(24);
    });

    it("should have consistent servers between service methods and config", () => {
      const result = importExportService.importFromFile(importFile);
      importExportService.mergeServersWithDecisions(result.servers || [], new Map());

      const localViaService = configService.getLocalServers();
      const remoteViaService = configService.getRemoteServers();

      const config = configService.getConfig();

      expect(localViaService.length).toBe(config.servers.length);
      expect(remoteViaService.length).toBe(config.remoteServers.length);
    });
  });
});
