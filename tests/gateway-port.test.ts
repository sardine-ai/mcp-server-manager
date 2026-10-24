import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import TOML from "@iarna/toml";

const daemon = vi.hoisted(() => ({
  getPortUpdateStatus: vi.fn((): { running: boolean; pid?: number } => ({ running: false })),
  checkHealth: vi.fn(async () => ({ status: "ok" })),
  refreshDaemon: vi.fn(async () => ({ success: true })),
}));
vi.mock("../src/services/daemon.service.js", () => ({ getDaemonService: () => daemon }));

import { changeGatewayPort } from "../src/services/gateway-port.service.js";
import { ClientService, resetClientService } from "../src/services/client.service.js";
import { getClientStrategy } from "../src/services/clients/index.js";
import { getConfigService, resetConfigService } from "../src/services/config.service.js";
import { getSettingsService, resetSettingsService } from "../src/services/settings.service.js";
import { ProjectConnectionsService } from "../src/services/project-connections.service.js";
import type { ClientId } from "../src/types/index.js";

describe("Gateway port changes", () => {
  let root: string;

  function connect(project: string, clientId: ClientId, profileId?: string) {
    const projectDir = path.join(root, project);
    const strategy = getClientStrategy(clientId, projectDir);
    if (!strategy) throw new Error("Unknown client");
    expect(strategy.writeConfig({ marker: "keep" })).toBe(true);
    if (clientId === "codex") {
      fs.writeFileSync(path.join(projectDir, ".codex/config.toml"), 'marker = "keep"\n');
    }
    expect(new ClientService(projectDir).connectClient(clientId, profileId).success).toBe(true);
    return { projectDir, strategy };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-port-review-"));
    vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "user"));
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", path.join(root, "manager"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "user", ".config"));
    vi.stubEnv("APPDATA", path.join(root, "user", "AppData"));
    vi.stubEnv("PATH", "");
    resetClientService();
    resetConfigService();
    resetSettingsService();
    daemon.getPortUpdateStatus.mockReturnValue({ running: false });
    daemon.refreshDaemon.mockResolvedValue({ success: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetClientService();
    resetConfigService();
    resetSettingsService();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    "cursor",
    "kiro",
    "vscode",
    "claude-code",
    "codex",
    "gemini",
    "zed",
    "antigravity",
    "opencode",
  ] satisfies ClientId[])(
    "updates existing %s project gateways, including unknown profile IDs",
    async (clientId) => {
      const { projectDir, strategy } = connect("project", clientId, "deleted-profile");
      expect(new ClientService(projectDir).connectClient(clientId).success).toBe(true);
      const result = await changeGatewayPort(9000);
      expect(result).toMatchObject({ success: true, port: 9000, warnings: [] });
      const config = strategy.readConfig();
      if (clientId !== "codex") expect(config).toHaveProperty("marker", "keep");
      expect(strategy.getGatewayKeys(config || {}).sort()).toEqual([
        "mcpsm",
        "mcpsm-deleted-profile",
      ]);
      const text = fs.readFileSync(
        new ClientService(projectDir).getClientConfigPath(clientId) || "",
        "utf8"
      );
      expect(text).toContain("localhost:9000/mcp");
      expect(text).toContain("keep");
      expect(text).not.toContain("localhost:8850");
      expect(getConfigService().getPort()).toBe(9000);
      expect(getSettingsService().get("port")).toBe(9000);
      expect(daemon.refreshDaemon).not.toHaveBeenCalled();
    }
  );

  it("updates global and multiple project connections after service recreation", async () => {
    const first = connect("one", "vscode", "one");
    const second = connect("two", "opencode", "two");
    const globalStrategy = getClientStrategy("vscode");
    if (!globalStrategy) throw new Error("Unknown client");
    globalStrategy.writeConfig({ servers: { unrelated: { command: "keep" } } });
    expect(new ClientService().connectClient("vscode", "global").success).toBe(true);
    resetClientService();
    expect((await changeGatewayPort(9100)).warnings).toEqual([]);
    for (const { projectDir } of [first, second]) {
      const configPath =
        projectDir === first.projectDir
          ? path.join(projectDir, ".vscode/mcp.json")
          : path.join(projectDir, "opencode.json");
      expect(fs.readFileSync(configPath, "utf8")).toContain("localhost:9100");
    }
    expect(globalStrategy.readConfig()?.servers).toMatchObject({
      unrelated: { command: "keep" },
      "mcpsm-global": { args: expect.arrayContaining(["http://localhost:9100/mcp/global"]) },
    });
  });

  it("does not recreate files or gateways removed outside mcpsm", async () => {
    const missing = connect("missing", "vscode");
    const disconnected = connect("disconnected", "vscode");
    fs.unlinkSync(path.join(missing.projectDir, ".vscode/mcp.json"));
    disconnected.strategy.writeConfig({ servers: { unrelated: { command: "keep" } } });
    const result = await changeGatewayPort(9000);
    expect(result.success).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("config is missing");
    expect(fs.existsSync(path.join(missing.projectDir, ".vscode/mcp.json"))).toBe(false);
    expect(disconnected.strategy.getGatewayKeys(disconnected.strategy.readConfig() || {})).toEqual(
      []
    );
    expect(new ProjectConnectionsService().list()).toHaveLength(2);
  });

  it("warns, updates reachable projects, and retries failed projects at the same port", async () => {
    const broken = connect("broken", "vscode", "dev");
    const valid = connect("valid", "cursor", "dev");
    const brokenPath = path.join(broken.projectDir, ".vscode/mcp.json");
    const original = fs.readFileSync(brokenPath, "utf8");
    fs.writeFileSync(brokenPath, "{broken");
    const result = await changeGatewayPort(9000);
    expect(result.success).toBe(false);
    expect(result.warnings[0]).toContain(brokenPath);
    expect(fs.readFileSync(brokenPath, "utf8")).toBe("{broken");
    expect(fs.readFileSync(path.join(valid.projectDir, ".cursor/mcp.json"), "utf8")).toContain(
      "localhost:9000"
    );
    fs.writeFileSync(brokenPath, original);
    expect((await changeGatewayPort(9000)).warnings).toEqual([]);
    expect(fs.readFileSync(brokenPath, "utf8")).toContain("localhost:9000");
  });

  it("reports read-only configs without undoing the saved port", async () => {
    const { projectDir } = connect("readonly", "vscode");
    const configPath = path.join(projectDir, ".vscode/mcp.json");
    const before = fs.readFileSync(configPath, "utf8");
    const originalWrite = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation((file, data, options) => {
      if (file === configPath) throw new Error("EACCES");
      return originalWrite(file, data, options);
    });
    const result = await changeGatewayPort(9000);
    expect(result.success).toBe(false);
    expect(result.warnings[0]).toContain("Failed to update client port");
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
    expect(getConfigService().getPort()).toBe(9000);
  });

  it("preserves unrelated Codex MCP options during global port updates", async () => {
    const configPath = path.join(root, "user/.codex/config.toml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const other = { url: "https://example.com", enabled: false, http_headers: { custom: "keep" } };
    fs.writeFileSync(
      configPath,
      TOML.stringify({
        model: "keep",
        mcp_servers: {
          other,
          disabled: { enabled: false },
          mcpsm: { url: "http://localhost:8850/mcp", enabled: false },
        },
      })
    );
    expect((await changeGatewayPort(9000)).warnings).toEqual([]);
    expect(TOML.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
      model: "keep",
      mcp_servers: {
        other,
        disabled: { enabled: false },
        mcpsm: { url: "http://localhost:9000/mcp", enabled: false },
      },
    });
  });

  it("preserves disabled OpenCode gateways and custom Zed headers", async () => {
    const openCode = connect("opencode", "opencode", "dev");
    const openCodePath = path.join(openCode.projectDir, "opencode.json");
    const openCodeConfig = JSON.parse(fs.readFileSync(openCodePath, "utf8"));
    openCodeConfig.mcp["mcpsm-dev"].enabled = false;
    fs.writeFileSync(openCodePath, JSON.stringify(openCodeConfig));
    const zed = connect("zed", "zed", "dev");
    const zedPath = path.join(zed.projectDir, ".zed/settings.json");
    const zedConfig = JSON.parse(fs.readFileSync(zedPath, "utf8"));
    zedConfig.context_servers["mcpsm-dev"].headers = { "X-Custom": "keep" };
    fs.writeFileSync(zedPath, JSON.stringify(zedConfig));
    expect((await changeGatewayPort(9000)).warnings).toEqual([]);
    expect(JSON.parse(fs.readFileSync(openCodePath, "utf8")).mcp["mcpsm-dev"]).toMatchObject({
      enabled: false,
      url: "http://localhost:9000/mcp/dev",
    });
    expect(JSON.parse(fs.readFileSync(zedPath, "utf8")).context_servers["mcpsm-dev"]).toMatchObject(
      { headers: { "X-Custom": "keep" }, url: "http://localhost:9000/mcp/dev" }
    );
  });

  it("preserves a malformed registry and reports that projects were skipped", async () => {
    const registryPath = getConfigService().getPaths().clientsStatePath;
    fs.writeFileSync(registryPath, "{broken");
    const result = await changeGatewayPort(9000);
    expect(result.success).toBe(false);
    expect(result.warnings[0]).toContain("Project gateways could not be updated");
    expect(fs.readFileSync(registryPath, "utf8")).toBe("{broken");
  });

  it("refreshes a running daemon using its captured identity", async () => {
    daemon.getPortUpdateStatus.mockReturnValue({ running: true, pid: 12345 });
    expect((await changeGatewayPort(9000)).warnings).toEqual([]);
    expect(daemon.getPortUpdateStatus).toHaveBeenCalledWith();
    expect(daemon.refreshDaemon).toHaveBeenCalledWith({ running: true, pid: 12345 }, true);
  });

  it("warns when daemon refresh fails after saving the port", async () => {
    daemon.getPortUpdateStatus.mockReturnValue({ running: true, pid: 12345 });
    daemon.refreshDaemon.mockRejectedValue(new Error("signal failed"));
    const result = await changeGatewayPort(9000);
    expect(result.success).toBe(false);
    expect(result.warnings[0]).toContain("Restart the daemon");
    expect(getConfigService().getPort()).toBe(9000);
  });

  it("restores the previous in-memory port when saving config fails", async () => {
    const service = getConfigService();
    const configPath = service.getPaths().configPath;
    const before = fs.readFileSync(configPath, "utf8");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("cannot save port");
    });
    expect(await changeGatewayPort(9000)).toMatchObject({
      success: false,
      error: "cannot save port",
    });
    expect(service.getPort()).toBe(8850);
    expect(fs.readFileSync(configPath, "utf8")).toBe(before);
    expect(daemon.refreshDaemon).not.toHaveBeenCalled();
  });

  it.each([0, -1, 65536, 1.5, NaN])(
    "rejects invalid port %s without changing files",
    async (port) => {
      const before = getConfigService().getPort();
      expect((await changeGatewayPort(port)).success).toBe(false);
      expect(getConfigService().getPort()).toBe(before);
      expect(daemon.getPortUpdateStatus).not.toHaveBeenCalled();
    }
  );
});
