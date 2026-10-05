import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import TOML from "@iarna/toml";
import { ClientService, resetClientService } from "../src/services/client.service.js";
import { getClientStrategy } from "../src/services/clients/index.js";
import { resetConfigService } from "../src/services/config.service.js";
import type { ClientId } from "../src/types/index.js";

const projectPaths = {
  cursor: ".cursor/mcp.json",
  kiro: ".kiro/settings/mcp.json",
  vscode: ".vscode/mcp.json",
  "claude-code": ".mcp.json",
  codex: ".codex/config.toml",
  gemini: ".gemini/settings.json",
  zed: ".zed/settings.json",
  antigravity: ".agents/mcp_config.json",
  opencode: "opencode.json",
} satisfies Partial<Record<ClientId, string>>;

describe("Project client connections", () => {
  let root: string;
  let project: string;
  let service: ClientService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-project-"));
    project = path.join(root, "project");
    fs.mkdirSync(project);
    vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "home", ".config"));
    vi.stubEnv("APPDATA", path.join(root, "home", "AppData"));
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", path.join(root, "manager"));
    resetClientService();
    resetConfigService();
    service = new ClientService(project);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetClientService();
    resetConfigService();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each(Object.entries(projectPaths))(
    "connects and disconnects %s only in the selected folder",
    (id, relativePath) => {
      const globalService = new ClientService();
      if (!globalService.clientExists(id)) throw new Error("Unknown client");
      const globalStrategy = getClientStrategy(id);
      if (!globalStrategy) throw new Error("Unknown client");
      const primaryPath = globalService.getClientConfigPath(id);
      if (!primaryPath) throw new Error("Missing global path");
      fs.mkdirSync(path.dirname(primaryPath), { recursive: true });
      expect(globalStrategy.writeConfig({ marker: "global" })).toBe(true);
      const globalPath = globalStrategy.getEffectiveConfigPath(
        process.platform as "darwin" | "linux" | "win32"
      );
      if (!globalPath) throw new Error("Missing global path");
      const globalBefore = fs.readFileSync(globalPath, "utf8");
      const localPath = path.join(project, relativePath);

      expect(service.getClientConfigPath(id)).toBe(localPath);
      expect(service.connectClient(id, "dev").success).toBe(true);
      expect(service.getConnectionStatus(id, "dev")).toBe("connected");
      expect(service.getConnectionStatus(id, "other")).toBe("disconnected");
      expect(fs.readFileSync(localPath, "utf8")).toContain("/mcp/dev");
      expect(globalService.getConnectionStatus(id, "dev")).toBe("disconnected");
      expect(new ClientService(path.join(root, "other")).getConnectionStatus(id, "dev")).toBe(
        "disconnected"
      );
      expect(service.disconnectClient(id, "dev").success).toBe(true);
      expect(service.getConnectionStatus(id, "dev")).toBe("disconnected");
      expect(fs.readFileSync(globalPath, "utf8")).toBe(globalBefore);
    }
  );

  it("preserves JSONC settings and other servers in an existing OpenCode file", () => {
    const configPath = path.join(project, "opencode.jsonc");
    fs.writeFileSync(
      configPath,
      '{ // settings\n "model": "test", "mcp": { "other": { "type": "remote", "url": "https://example.com/mcp", "enabled": false } }, }'
    );
    expect(service.connectClient("opencode", "dev").success).toBe(true);
    expect(service.getClientConfigPath("opencode")).toBe(configPath);
    expect(fs.existsSync(path.join(project, "opencode.json"))).toBe(false);
    expect(service.disconnectClient("opencode", "dev").success).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toMatchObject({
      model: "test",
      mcp: { other: { enabled: false } },
    });
  });

  it("preserves Codex settings and all options on other MCP servers", () => {
    const configPath = path.join(project, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(configPath));
    const original = {
      model: "test",
      mcp_servers: {
        other: {
          url: "https://example.com/mcp",
          enabled: false,
          startup_timeout_sec: 42,
          http_headers: { Authorization: "test" },
        },
        disabled: { enabled: false },
      },
    };
    fs.writeFileSync(configPath, TOML.stringify(original));
    expect(service.connectClient("codex", "dev").success).toBe(true);
    expect(service.disconnectClient("codex", "dev").success).toBe(true);
    expect(TOML.parse(fs.readFileSync(configPath, "utf8"))).toEqual(original);
  });

  it("replaces a project Codex stdio gateway with HTTP without retaining its command", () => {
    const configPath = path.join(project, ".codex", "config.toml");
    fs.mkdirSync(path.dirname(configPath));
    fs.writeFileSync(
      configPath,
      TOML.stringify({ mcp_servers: { "mcpsm-dev": { command: "old", args: ["old"] } } })
    );
    expect(service.connectClient("codex", "dev").success).toBe(true);
    const config = TOML.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.mcp_servers).toEqual({
      "mcpsm-dev": { url: expect.stringContaining("/mcp/dev") },
    });
  });

  it("does not overwrite an invalid project config", () => {
    const configPath = path.join(project, ".mcp.json");
    fs.writeFileSync(configPath, "{invalid}");
    expect(service.connectClient("claude-code").success).toBe(false);
    expect(service.disconnectClient("claude-code").success).toBe(false);
    expect(fs.readFileSync(configPath, "utf8")).toBe("{invalid}");
  });

  it("excludes clients without project support and rejects connecting them", () => {
    expect(
      service
        .detectClients()
        .map((client) => client.id)
        .sort()
    ).toEqual(Object.keys(projectPaths).sort());
    expect(service.connectClient("claude")).toEqual({
      success: false,
      error: "Client does not support project configuration",
    });
    expect(service.getClientConfigPath("windsurf")).toBeNull();
  });
});
