import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import TOML from "@iarna/toml";
import { AntigravityStrategy } from "../src/services/clients/antigravity.strategy.js";
import { ClaudeCodeStrategy } from "../src/services/clients/claude-code.strategy.js";
import { CodexStrategy } from "../src/services/clients/codex.strategy.js";
import { CursorStrategy } from "../src/services/clients/cursor.strategy.js";

const BRIDGE = { command: "mcpsm", args: ["bridge", "http://localhost:8850/mcp"] };

describe("client gateway entries", () => {
  let root: string;
  let home: string;

  const write = (file: string, contents: string): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-bridge-config-"));
    home = path.join(root, "home");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("PATH", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("Antigravity global config path", () => {
    it("uses ~/.gemini/config/mcp_config.json and the mcpServers command format", () => {
      write(path.join(home, ".gemini/config/.migrated"), "");
      write(path.join(home, ".gemini/antigravity/installation_id"), "x");
      const strategy = new AntigravityStrategy();
      const configPath = path.join(home, ".gemini/config/mcp_config.json");

      expect(strategy.getEffectiveConfigPath("darwin")).toBe(configPath);
      expect(strategy.isInstalled("darwin")).toBe(true);
      expect(strategy.connect(8850).success).toBe(true);
      expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
        mcpServers: { mcpsm: BRIDGE },
      });
      expect(fs.existsSync(path.join(home, ".antigravity"))).toBe(false);
    });

    it("keeps using an existing ~/.gemini/antigravity/mcp_config.json from older builds", () => {
      const legacy = path.join(home, ".gemini/antigravity/mcp_config.json");
      write(legacy, '{"mcpServers":{"other":{"command":"node"}}}');
      const strategy = new AntigravityStrategy();

      expect(strategy.getEffectiveConfigPath("darwin")).toBe(legacy);
      expect(strategy.connect(8850).success).toBe(true);
      expect(JSON.parse(fs.readFileSync(legacy, "utf8")).mcpServers).toEqual({
        other: { command: "node" },
        mcpsm: BRIDGE,
      });
    });

    it("prefers the current file when both exist, and defaults to it when neither does", () => {
      const current = path.join(home, ".gemini/config/mcp_config.json");
      expect(new AntigravityStrategy().getEffectiveConfigPath("linux")).toBe(current);
      write(path.join(home, ".gemini/antigravity/mcp_config.json"), "{}");
      write(current, "{}");
      expect(new AntigravityStrategy().getEffectiveConfigPath("linux")).toBe(current);
    });
  });

  it("writes a stdio bridge to ~/.claude.json, keeping Claude Code's other settings", () => {
    const configPath = path.join(home, ".claude.json");
    write(
      configPath,
      JSON.stringify({
        numStartups: 3,
        projects: { "/x": { mcpServers: {} } },
        mcpServers: { mcpsm: { type: "http", url: "http://localhost:8850/mcp" } },
      })
    );

    expect(new ClaudeCodeStrategy().connect(8850).success).toBe(true);
    expect(JSON.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
      numStartups: 3,
      projects: { "/x": { mcpServers: {} } },
      mcpServers: { mcpsm: BRIDGE },
    });
  });

  it("writes a stdio bridge to ~/.codex/config.toml", () => {
    const configPath = path.join(home, ".codex/config.toml");
    write(configPath, 'model = "gpt"\n[mcp_servers.mcpsm]\nurl = "http://localhost:8850/mcp"\n');

    expect(new CodexStrategy().connect(8850).success).toBe(true);
    expect(TOML.parse(fs.readFileSync(configPath, "utf8"))).toEqual({
      model: "gpt",
      mcp_servers: { mcpsm: BRIDGE },
    });
  });

  it("passes Cursor's workspace folder to the bridge", () => {
    expect(new CursorStrategy().buildGatewayConfig(8850, "dev")).toEqual({
      command: "mcpsm",
      args: ["bridge", "http://localhost:8850/mcp/dev", "--cwd", "${workspaceFolder}"],
    });
  });

  it.skipIf(process.platform === "win32")(
    "uses the absolute mcpsm path so GUI clients without the shell PATH find it",
    () => {
      const bin = path.join(root, "bin");
      write(path.join(bin, "mcpsm"), "#!/bin/sh\n");
      fs.chmodSync(path.join(bin, "mcpsm"), 0o755);
      vi.stubEnv("PATH", bin);
      expect(new CodexStrategy().buildGatewayConfig(8850).command).toBe(path.join(bin, "mcpsm"));
    }
  );
});
