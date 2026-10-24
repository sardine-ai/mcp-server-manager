import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// Test config directory
const testConfigDir = path.join(os.tmpdir(), "mcpsm-cli-test-" + Date.now());

describe("CLI Integration Tests", () => {
  it("reports a partial import with an unsuccessful exit status", () => {
    const file = path.join(testConfigDir, "import.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        servers: [
          { id: "INVALID ID", name: "Invalid", command: "node" },
          { id: "valid", name: "Valid", command: "node" },
        ],
      })
    );
    const result = spawnSync(process.execPath, ["bin/cli.js", "import", file, "--skip"], {
      encoding: "utf8",
      env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Added: 1");
    expect(result.stderr).toContain("INVALID ID");
    expect(
      JSON.parse(fs.readFileSync(path.join(testConfigDir, "config.json"), "utf8")).servers.map(
        (server: { id: string }) => server.id
      )
    ).toEqual(["valid"]);
  });

  it("reports malformed storage without replacing it", () => {
    const file = path.join(testConfigDir, "config.json");
    fs.writeFileSync(file, "{broken");
    const result = spawnSync(process.execPath, ["bin/cli.js", "list"], {
      encoding: "utf8",
      env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(file);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
  });

  beforeEach(() => {
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", testConfigDir);
    // Create test config directory
    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Create minimal config
    const configPath = path.join(testConfigDir, "config.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        port: 8850,
        servers: [],
        remoteServers: [],
      })
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // Cleanup
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  describe("mcpsm version", () => {
    it("should display version", () => {
      const result = execSync("node bin/cli.js --version", {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(result).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe("mcpsm help", () => {
    it("should display help", () => {
      const result = execSync("node bin/cli.js --help", {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(result).toContain("mcpsm");
      expect(result).toContain("Commands");
    });
  });

  describe("mcpsm list", () => {
    it("should list servers (empty)", () => {
      const result = execSync("node bin/cli.js list", {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
      });
      // Should not throw, may show "no servers" message
      expect(result).toBeDefined();
    });

    it("should accept --json flag without error", () => {
      // Note: There's a known issue where --json is captured by parent command
      // This test just verifies the command runs without throwing
      const result = execSync("node bin/cli.js list --json", {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
      });
      expect(result).toBeDefined();
    });
  });

  describe("mcpsm doctor", () => {
    it("should run health checks", () => {
      const result = execSync("node bin/cli.js doctor", {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      expect(result).toContain("Node.js");
    });
  });

  describe("mcpsm settings", () => {
    it("should list settings", () => {
      const result = execSync("node bin/cli.js settings", {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
      });
      expect(result).toContain("port");
    });

    it("should get a specific setting", () => {
      const result = execSync("node bin/cli.js settings get port", {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
      });
      expect(result).toContain("8850");
    });
  });

  describe("mcpsm clients", () => {
    it("should list clients", () => {
      const result = execSync("node bin/cli.js clients", {
        encoding: "utf8",
        cwd: process.cwd(),
      });
      // Should show detected clients or message
      expect(result).toBeDefined();
    });
  });

  describe("mcpsm profile", () => {
    it("should list profiles", () => {
      // Create profiles file
      const profilesPath = path.join(testConfigDir, "profiles.json");
      fs.writeFileSync(
        profilesPath,
        JSON.stringify({
          profiles: { default: { name: "Default", servers: [], remoteServers: [] } },
          activeProfile: "default",
        })
      );

      const result = execSync("node bin/cli.js profile list", {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, MCP_MANAGER_CONFIG_DIR: testConfigDir },
      });
      expect(result).toContain("default");
    });
  });
});
