import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { CodexStrategy } from "../src/services/clients/codex.strategy.js";
import { OpenCodeStrategy } from "../src/services/clients/opencode.strategy.js";

function setPrimaryPath(
  strategy: { paths: { primary: Record<string, string> } },
  configPath: string
): void {
  strategy.paths.primary.darwin = configPath;
  strategy.paths.primary.linux = configPath;
  strategy.paths.primary.win32 = configPath;
}

describe("additional client strategies", () => {
  let tempDir: string;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-strategy-extra-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalXdgConfigHome === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }
  });

  it("reads and writes Codex TOML configs while preserving unrelated settings", () => {
    const strategy = new CodexStrategy();
    const configPath = path.join(tempDir, ".codex", "config.toml");
    setPrimaryPath(strategy, configPath);

    expect(strategy.readConfig()).toBeNull();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "[mcp_servers.bad\n");
    expect(strategy.readConfig()).toBeNull();

    fs.writeFileSync(
      configPath,
      `
approval_policy = "never"

[mcp_servers.local]
command = "node"
args = ["server.js"]

[mcp_servers.remote]
url = "https://api.test/mcp"
type = "http"

[mcp_servers.noop]
foo = "bar"
`
    );

    expect(strategy.readConfig()).toEqual({
      mcpServers: {
        local: { command: "node", args: ["server.js"] },
        remote: { url: "https://api.test/mcp", type: "http" },
      },
    });

    const updated = strategy.addGateway({ mcpServers: {} }, 8850, "dev");
    expect(updated).toEqual({
      mcpServers: {
        "mcpsm-dev": {
          url: "http://localhost:8850/mcp/dev",
        },
      },
    });

    expect(
      strategy.writeConfig({
        mcpServers: {
          local: {
            command: "node",
            args: ["server.js"],
            env: { API_KEY: "secret" },
          },
          remote: {
            url: "https://api.test/mcp",
            type: "http",
          },
          empty: {},
        },
      })
    ).toBe(true);

    const written = fs.readFileSync(configPath, "utf8");
    expect(written).toContain('approval_policy = "never"');
    expect(written).toContain("[mcp_servers.local]");
    expect(written).toContain("[mcp_servers.remote]");
    expect(written).not.toContain("[mcp_servers.empty]");
  });

  it("writes a new Codex TOML config when the directory does not exist", () => {
    const strategy = new CodexStrategy();
    const configPath = path.join(tempDir, "nested", "config.toml");
    setPrimaryPath(strategy, configPath);

    expect(
      strategy.writeConfig({
        mcpServers: {
          mcpsm: strategy.buildGatewayConfig(8850),
        },
      })
    ).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    expect(strategy.readConfig()?.mcpServers?.mcpsm.url).toBe("http://localhost:8850/mcp");
  });

  it("handles OpenCode XDG config discovery, install detection, and gateway shape", () => {
    process.env.XDG_CONFIG_HOME = path.join(tempDir, "xdg");
    const strategy = new OpenCodeStrategy();
    const configPath = path.join(process.env.XDG_CONFIG_HOME, "opencode", "config.json");

    expect(strategy.readConfig()).toBeNull();
    expect(strategy.isInstalled(process.platform)).toBe(false);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    expect(strategy.isInstalled(process.platform)).toBe(true);
    expect(strategy.buildGatewayConfig(8850)).toEqual({
      type: "remote",
      url: "http://localhost:8850/mcp",
    });

    const config = strategy.addGateway({ mcp: { docs: { url: "https://docs.test" } } }, 8850);
    expect(config).toEqual({
      $schema: "https://opencode.ai/config.json",
      mcp: {
        docs: { url: "https://docs.test" },
        mcpsm: { type: "remote", url: "http://localhost:8850/mcp" },
      },
    });
    expect(strategy.writeConfig(config)).toBe(true);
    expect(strategy.readConfig()).toEqual(config);
    expect(strategy.hasGateway(config)).toBe(true);
    expect(strategy.getServerCount()).toBe(2);
    expect(strategy.removeGateway(config).mcp).toEqual({ docs: { url: "https://docs.test" } });
  });

  it("returns null or false for malformed OpenCode config files", () => {
    process.env.XDG_CONFIG_HOME = path.join(tempDir, "xdg");
    const strategy = new OpenCodeStrategy();
    const configPath = path.join(process.env.XDG_CONFIG_HOME, "opencode", "config.json");

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{ invalid");

    expect(strategy.readConfig()).toBeNull();
  });
});
