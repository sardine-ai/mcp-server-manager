import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { ConfigService, resetConfigService } from "../src/services/config.service.js";

// Test directory setup
const testConfigDir = path.join(os.tmpdir(), "mcpsm-config-test-" + Date.now());

const fileMode = (filePath: string): number => fs.statSync(filePath).mode & 0o777;

describe("ConfigService", () => {
  let configService: ConfigService;

  beforeEach(() => {
    // Set env variable to use test directory
    process.env.MCP_MANAGER_CONFIG_DIR = testConfigDir;
    resetConfigService();

    // Ensure test directory exists
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    resetConfigService();
  });

  describe("loadConfig", () => {
    it("should create default config if none exists", () => {
      configService = new ConfigService(testConfigDir);

      const config = configService.getConfig();
      expect(config).toBeDefined();
      expect(config.servers).toEqual([]);
      expect(config.remoteServers).toEqual([]);
      expect(config.port).toBe(8850);

      const paths = configService.getPaths();
      expect(fs.existsSync(paths.configPath)).toBe(true);
    });

    it("creates the config directory and config file with private permissions", () => {
      if (process.platform === "win32") return;

      fs.rmSync(testConfigDir, { recursive: true, force: true });
      const originalUmask = process.umask(0o022);
      try {
        configService = new ConfigService(testConfigDir);
      } finally {
        process.umask(originalUmask);
      }

      const paths = configService.getPaths();
      expect(fileMode(paths.configDir)).toBe(0o700);
      expect(fileMode(paths.configPath)).toBe(0o600);
    });

    it("repairs existing insecure config directory and file permissions", () => {
      if (process.platform === "win32") return;

      const configPath = path.join(testConfigDir, "config.json");
      fs.chmodSync(testConfigDir, 0o755);
      fs.writeFileSync(configPath, JSON.stringify({ port: 8850 }), { mode: 0o644 });
      fs.chmodSync(configPath, 0o644);

      configService = new ConfigService(testConfigDir);

      expect(fileMode(testConfigDir)).toBe(0o700);
      expect(fileMode(configPath)).toBe(0o600);
    });

    it("should load existing config", () => {
      const configPath = path.join(testConfigDir, "config.json");
      const existingConfig = {
        servers: [{ id: "test", name: "Test", command: "test", args: [] }],
        remoteServers: [],
        port: 9000,
      };
      fs.writeFileSync(configPath, JSON.stringify(existingConfig));

      configService = new ConfigService(testConfigDir);
      const config = configService.getConfig();

      expect(config.servers).toHaveLength(1);
      expect(config.servers[0].id).toBe("test");
      expect(config.port).toBe(9000);
    });

    it("should initialize empty arrays for missing server arrays", () => {
      const configPath = path.join(testConfigDir, "config.json");
      fs.writeFileSync(configPath, JSON.stringify({ port: 8850 }));

      configService = new ConfigService(testConfigDir);
      const config = configService.getConfig();

      expect(config.servers).toEqual([]);
      expect(config.remoteServers).toEqual([]);
    });
  });

  describe("saveConfig", () => {
    it("should save config to file", () => {
      configService = new ConfigService(testConfigDir);
      const paths = configService.getPaths();

      const result = configService.addLocalServer({
        id: "new-server",
        name: "New Server",
        command: "node",
        args: [],
      });
      expect(result.success).toBe(true);

      const saved = JSON.parse(fs.readFileSync(paths.configPath, "utf8"));
      expect(saved.servers).toHaveLength(1);
      expect(saved.servers[0].id).toBe("new-server");
    });
  });

  describe("loadToolFilters", () => {
    it("should return empty object if no file exists", () => {
      configService = new ConfigService(testConfigDir);
      const toolFilters = configService.getToolFilters();
      expect(toolFilters).toEqual({});
    });

    it("should load existing tool filters", () => {
      const toolFiltersPath = path.join(testConfigDir, "tool-filters.json");
      const existingFilters = {
        "test-server": {
          enabled: ["tool1", "tool2"],
          allTools: ["tool1", "tool2", "tool3"],
        },
      };
      fs.writeFileSync(toolFiltersPath, JSON.stringify(existingFilters));

      configService = new ConfigService(testConfigDir);
      const toolFilters = configService.getToolFilters();

      expect(toolFilters["test-server"]).toBeDefined();
      expect(toolFilters["test-server"].allTools).toHaveLength(3);
    });
  });

  describe("saveToolFilters", () => {
    it("should save tool filters to file", () => {
      configService = new ConfigService(testConfigDir);
      const paths = configService.getPaths();

      configService.setServerToolFilter("new-server", {
        allTools: ["tool1", "tool2"],
        disabledTools: [],
      });

      const saved = JSON.parse(fs.readFileSync(paths.toolFiltersPath, "utf8"));
      expect(saved["new-server"]).toBeDefined();
      expect(saved["new-server"].allTools).toEqual(["tool1", "tool2"]);
    });
  });

  describe("Selection State", () => {
    it("should load saved selection state", () => {
      const selectionPath = path.join(testConfigDir, "selection-state.json");
      fs.writeFileSync(
        selectionPath,
        JSON.stringify({
          local: ["server1", "server2"],
          remote: ["remote1"],
        })
      );

      configService = new ConfigService(testConfigDir);
      const selectionState = configService.getSelectionState();

      expect(selectionState.local).toEqual(["server1", "server2"]);
      expect(selectionState.remote).toEqual(["remote1"]);
    });

    it("should save selection state", () => {
      const configPath = path.join(testConfigDir, "config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          servers: [{ id: "s1", name: "S1", command: "test", args: [] }],
          remoteServers: [{ id: "r1", name: "R1", type: "http", url: "http://localhost" }],
          port: 8850,
        })
      );

      configService = new ConfigService(testConfigDir);
      const paths = configService.getPaths();

      configService.saveSelectionState({ local: ["s1"], remote: ["r1"] });

      const saved = JSON.parse(fs.readFileSync(paths.selectionStatePath, "utf8"));
      expect(saved.local).toContain("s1");
      expect(saved.remote).toContain("r1");
    });
  });

  describe("Server CRUD Operations", () => {
    beforeEach(() => {
      configService = new ConfigService(testConfigDir);
    });

    it("should add local server", () => {
      const result = configService.addLocalServer({
        id: "test-local",
        name: "Test Local",
        command: "node",
        args: ["server.js"],
      });

      expect(result.success).toBe(true);
      expect(configService.findLocalServer("test-local")).toBeDefined();
    });

    it("should add remote server", () => {
      const result = configService.addRemoteServer({
        id: "test-remote",
        name: "Test Remote",
        type: "http",
        url: "http://localhost:3000",
      });

      expect(result.success).toBe(true);
      expect(configService.findRemoteServer("test-remote")).toBeDefined();
    });

    it("should not add duplicate server", () => {
      configService.addLocalServer({
        id: "dup-test",
        name: "Dup Test",
        command: "node",
        args: [],
      });

      const result = configService.addLocalServer({
        id: "dup-test",
        name: "Dup Test 2",
        command: "python",
        args: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("should delete local server", () => {
      configService.addLocalServer({
        id: "to-delete",
        name: "To Delete",
        command: "node",
        args: [],
      });

      const result = configService.deleteLocalServer("to-delete");
      expect(result.success).toBe(true);
      expect(configService.findLocalServer("to-delete")).toBeUndefined();
    });
  });
});
