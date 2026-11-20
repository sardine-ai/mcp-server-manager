import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ClientService, resetClientService } from "../src/services/client.service.js";
import { getClientStrategy } from "../src/services/clients/index.js";
import { CursorStrategy } from "../src/services/clients/cursor.strategy.js";
import { OpenCodeStrategy } from "../src/services/clients/opencode.strategy.js";
import { KiroStrategy } from "../src/services/clients/kiro.strategy.js";
import { VSCodeStrategy } from "../src/services/clients/vscode.strategy.js";
import { ProjectConnectionsService } from "../src/services/project-connections.service.js";
import { getConfigService, resetConfigService } from "../src/services/config.service.js";
import { getProfileService, resetProfileService } from "../src/services/profile.service.js";
import type { ClientId } from "../src/types/index.js";

describe("Client review regressions", () => {
  let root: string;
  let projectDir: string;
  let scratchHome: string;

  function write(filePath: string, contents: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-client-review-"));
    projectDir = path.join(root, "project");
    scratchHome = path.join(root, "user");
    fs.mkdirSync(projectDir);
    vi.spyOn(os, "homedir").mockReturnValue(scratchHome);
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", path.join(root, "manager"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(scratchHome, ".config"));
    vi.stubEnv("APPDATA", path.join(scratchHome, "AppData"));
    vi.stubEnv("PATH", path.join(root, "bin"));
    resetClientService();
    resetConfigService();
    resetProfileService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetClientService();
    resetConfigService();
    resetProfileService();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("bootstraps Cursor project config with only the global secondary config", () => {
    write(path.join(scratchHome, ".cursor/mcp.json"), "{}");
    const strategy = new CursorStrategy(projectDir);
    expect(strategy.isInstalled("linux")).toBe(true);
    expect(strategy.connect(8850, "dev").success).toBe(true);
    expect(fs.readFileSync(path.join(projectDir, ".cursor/mcp.json"), "utf8")).toContain(
      "/mcp/dev"
    );
  });

  it("keeps the OpenCode legacy global installation signal in project scope", () => {
    const legacyPath = path.join(scratchHome, ".opencode.json");
    write(legacyPath, '{"model":"existing"}');
    const strategy = new OpenCodeStrategy(projectDir);
    expect(strategy.isInstalled("win32")).toBe(true);
    expect(strategy.connect(8850, "dev").success).toBe(true);
    expect(fs.readFileSync(legacyPath, "utf8")).toBe('{"model":"existing"}');
    expect(fs.readFileSync(path.join(projectDir, "opencode.json"), "utf8")).toContain("/mcp/dev");
  });

  it.skipIf(process.platform === "win32")(
    "detects PATH executables without creating global MCP directories",
    () => {
      const executable = path.join(root, "bin", "kiro");
      write(executable, "#!/bin/sh\n");
      fs.chmodSync(executable, 0o755);
      const strategy = new KiroStrategy(projectDir);
      strategy.paths.appBundles = {};
      expect(strategy.isInstalled("linux")).toBe(true);
      expect(strategy.connect(8850).success).toBe(true);
      expect(fs.existsSync(path.join(scratchHome, ".kiro"))).toBe(false);
      fs.chmodSync(executable, 0o644);
      expect(new KiroStrategy(path.join(root, "fresh")).isInstalled("linux")).toBe(false);
    }
  );

  it("honors Windows PATHEXT and rejects directories named like executables", () => {
    vi.stubEnv("PATHEXT", ".CMD;.EXE");
    write(path.join(root, "bin", "opencode.cmd"), "@echo off");
    const strategy = new OpenCodeStrategy(projectDir);
    expect(strategy.isInstalled("win32")).toBe(true);
    fs.unlinkSync(path.join(root, "bin", "opencode.cmd"));
    fs.mkdirSync(path.join(root, "bin", "opencode.cmd"));
    expect(strategy.isInstalled("win32")).toBe(false);
  });

  it.each(["{broken", '{ // comment\n "servers":{"existing":{"command":"node"}} }', "[]", "null"])(
    "does not overwrite unreadable global config: %s",
    (contents) => {
      const strategy = new VSCodeStrategy();
      const configPath = strategy.getEffectiveConfigPath(
        process.platform as "darwin" | "linux" | "win32"
      );
      if (!configPath) throw new Error("Missing config path");
      write(configPath, contents);
      expect(strategy.connect(8850).success).toBe(false);
      expect(strategy.disconnect().success).toBe(false);
      expect(fs.readFileSync(configPath, "utf8")).toBe(contents);
    }
  );

  it("leaves the legacy ~/.opencode.json alone and writes opencode.json", () => {
    const legacyPath = path.join(scratchHome, ".opencode.json");
    write(legacyPath, "{broken");
    const strategy = new OpenCodeStrategy();
    expect(strategy.connect(8850).success).toBe(true);
    expect(fs.readFileSync(legacyPath, "utf8")).toBe("{broken");
    expect(
      fs.readFileSync(path.join(scratchHome, ".config/opencode/opencode.json"), "utf8")
    ).toContain("localhost:8850/mcp");
  });

  it("does not overwrite an unreadable global opencode.json", () => {
    const configPath = path.join(scratchHome, ".config/opencode/opencode.json");
    write(configPath, "{broken");
    expect(new OpenCodeStrategy().connect(8850).success).toBe(false);
    expect(fs.readFileSync(configPath, "utf8")).toBe("{broken");
  });

  it.each(["cursor", "vscode", "codex", "zed", "opencode"] satisfies ClientId[])(
    "removes deleted profiles and bare gateways for %s, preserving other servers",
    (id) => {
      const strategy = getClientStrategy(id, projectDir);
      if (!strategy) throw new Error("Unknown client");
      const seed = strategy.addGateway({}, 8850, "other");
      const container =
        id === "zed"
          ? "context_servers"
          : id === "opencode"
            ? "mcp"
            : id === "vscode"
              ? "servers"
              : "mcpServers";
      const value = seed[container];
      if (!value || typeof value !== "object") throw new Error("Missing container");
      const config = { ...seed, [container]: { unrelated: Object.values(value)[0] } };
      expect(strategy.writeConfig(config)).toBe(true);
      const profiles = getProfileService();
      expect(profiles.create("deleted").success).toBe(true);
      const service = new ClientService(projectDir);
      expect(service.connectClient(id, "deleted").success).toBe(true);
      expect(service.connectClient(id).success).toBe(true);
      expect(profiles.delete("deleted").success).toBe(true);
      expect(service.disconnectAllProfiles(id)).toMatchObject({
        succeeded: expect.arrayContaining(["deleted", "*"]),
        failed: [],
      });
      expect(strategy.getGatewayKeys(strategy.readConfig() || {})).toEqual([]);
      expect(strategy.readConfig()?.[container]).toHaveProperty("unrelated");
      expect(service.disconnectAllProfiles(id)).toEqual({ succeeded: [], failed: [] });
      expect(new ProjectConnectionsService().list()).toEqual([]);
    }
  );

  it("persists and deduplicates registrations until the last gateway is removed", () => {
    write(path.join(projectDir, ".vscode/mcp.json"), "{}");
    const service = new ClientService(projectDir);
    expect(service.connectClient("vscode", "one")).toEqual({ success: true, error: undefined });
    service.connectClient("vscode", "two");
    expect(new ProjectConnectionsService().list()).toEqual([{ projectDir, clientId: "vscode" }]);
    service.disconnectClient("vscode", "one");
    expect(new ProjectConnectionsService().list()).toHaveLength(1);
    service.disconnectClient("vscode", "two");
    expect(new ProjectConnectionsService().list()).toEqual([]);
  });

  it("warns about corrupt tracking without overwriting it or undoing a connection", () => {
    write(path.join(projectDir, ".vscode/mcp.json"), "{}");
    const registryPath = getConfigService().getPaths().clientsStatePath;
    write(registryPath, "{broken");
    const result = new ClientService(projectDir).connectClient("vscode", "dev");
    expect(result.success).toBe(true);
    expect(result.warnings?.[0]).toContain("Reconnect vscode");
    expect(fs.readFileSync(registryPath, "utf8")).toBe("{broken");
  });

  it.each([
    { projectConnections: "invalid" },
    { projectConnections: [{ projectDir: "relative", clientId: "vscode" }] },
    { projectConnections: [{ projectDir: "/project", clientId: "unknown" }] },
  ])("preserves invalid registry data: %j", (data) => {
    const registryPath = getConfigService().getPaths().clientsStatePath;
    const original = JSON.stringify(data);
    write(registryPath, original);
    expect(() => new ProjectConnectionsService().register(projectDir, "vscode")).toThrow(
      "Invalid project connection"
    );
    expect(fs.readFileSync(registryPath, "utf8")).toBe(original);
  });

  it("preserves other registry fields and writes private permissions", () => {
    const registryPath = getConfigService().getPaths().clientsStatePath;
    write(registryPath, '{"existing":"keep"}');
    new ProjectConnectionsService().register(projectDir, "vscode");
    expect(JSON.parse(fs.readFileSync(registryPath, "utf8"))).toMatchObject({
      existing: "keep",
      projectConnections: [{ projectDir, clientId: "vscode" }],
    });
    if (process.platform !== "win32") expect(fs.statSync(registryPath).mode & 0o777).toBe(0o600);
  });

  it("keeps registrations and reports every gateway when a full disconnect cannot write", () => {
    write(path.join(projectDir, ".vscode/mcp.json"), "{}");
    const service = new ClientService(projectDir);
    service.connectClient("vscode");
    service.connectClient("vscode", "dev");
    vi.spyOn(VSCodeStrategy.prototype, "writeConfig").mockReturnValue(false);
    expect(service.disconnectAllProfiles("vscode").failed).toEqual([
      { id: "*", error: "Failed to write config" },
      { id: "dev", error: "Failed to write config" },
    ]);
    expect(new ProjectConnectionsService().list()).toHaveLength(1);
  });
});
