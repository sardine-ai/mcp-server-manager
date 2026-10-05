import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ZedStrategy } from "../src/services/clients/zed.strategy.js";
import type { ClientMcpConfig } from "../src/types/index.js";

function setStrategyConfigPath(strategy: ZedStrategy, configPath: string): void {
  const primary = strategy.paths.primary as Record<string, string>;
  primary.darwin = configPath;
  primary.linux = configPath;
  primary.win32 = configPath;
}

describe("ZedStrategy", () => {
  let tempDir: string;
  let configPath: string;
  let strategy: ZedStrategy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-zed-test-"));
    configPath = path.join(tempDir, "zed", "settings.json");
    strategy = new ZedStrategy();
    setStrategyConfigPath(strategy, configPath);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null for missing or invalid config files", () => {
    expect(strategy.readConfig()).toBeNull();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, "{ invalid");
    expect(strategy.readConfig()).toBeNull();
  });

  it("reads JSON with comments and trailing commas while preserving comment-like strings", () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      `{
        // user settings
        "theme": "dark",
        "context_servers": {
          "docs": {
            "url": "https://example.test/path//not-a-comment",
          },
        },
        /*
          block comment
        */
      }`
    );

    expect(strategy.readConfig()).toEqual({
      theme: "dark",
      context_servers: {
        docs: {
          url: "https://example.test/path//not-a-comment",
        },
      },
    });
  });

  it("writes formatted config and creates parent directories", () => {
    const config: ClientMcpConfig = {
      context_servers: {
        docs: {
          url: "https://example.test/mcp",
        },
      },
    };

    expect(strategy.writeConfig(config)).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual(config);
  });

  it("builds global and profile-specific gateway URLs", () => {
    expect(strategy.buildGatewayConfig(8850)).toEqual({
      url: "http://localhost:8850/mcp",
    });
    expect(strategy.buildGatewayConfig(8850, "prod")).toEqual({
      url: "http://localhost:8850/mcp/prod",
    });
  });

  it("detects gateways from URL, headers, or settings", () => {
    expect(strategy.hasGateway(null)).toBe(false);
    expect(strategy.hasGateway({ context_servers: {} })).toBe(false);
    expect(
      strategy.hasGateway({
        context_servers: {
          mcpsm: {
            headers: { Authorization: "Bearer token" },
          },
        },
      })
    ).toBe(true);
    expect(
      strategy.hasGateway(
        {
          context_servers: {
            "mcpsm-dev": {
              settings: { enabled: true },
            },
          },
        },
        "dev"
      )
    ).toBe(true);
  });

  it("adds profile gateways without mutating existing context servers", () => {
    const config: ClientMcpConfig = {
      context_servers: {
        docs: {
          url: "https://example.test/mcp",
        },
      },
    };

    const updated = strategy.addGateway(config, 8850, "dev");

    expect(updated).toEqual({
      context_servers: {
        docs: {
          url: "https://example.test/mcp",
        },
        "mcpsm-dev": {
          url: "http://localhost:8850/mcp/dev",
          headers: {},
          settings: {},
        },
      },
    });
    expect(config).toEqual({
      context_servers: {
        docs: {
          url: "https://example.test/mcp",
        },
      },
    });
  });

  it("removes only the requested gateway", () => {
    let config = strategy.addGateway({ context_servers: {} }, 8850, "dev");
    config = strategy.addGateway(config, 8850, "prod");

    const updated = strategy.removeGateway(config, "dev");

    expect(strategy.hasGateway(updated, "dev")).toBe(false);
    expect(strategy.hasGateway(updated, "prod")).toBe(true);
    expect(strategy.removeGateway(updated, "missing")).toBe(updated);
  });

  it("counts Zed context servers and compatible MCP server containers", () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        context_servers: {
          docs: { url: "https://example.test" },
          mcpsm: { url: "http://localhost:8850/mcp" },
        },
        mcpServers: {
          local: { command: "node" },
        },
        servers: {
          remote: { url: "https://remote.test" },
        },
      })
    );

    expect(strategy.getServerCount()).toBe(4);
  });
});
