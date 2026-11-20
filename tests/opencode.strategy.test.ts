import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { OpenCodeStrategy } from "../src/services/clients/opencode.strategy.js";
import type { ClientMcpConfig } from "../src/types/index.js";

const OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";
const GATEWAY = {
  type: "local",
  command: [process.execPath, path.resolve("bin/cli.js"), "bridge", "http://localhost:8850/mcp"],
};

describe("OpenCodeStrategy", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-opencode-"));
    vi.spyOn(os, "homedir").mockReturnValue(path.join(root, "home"));
    vi.stubEnv("XDG_CONFIG_HOME", path.join(root, "xdg"));
    vi.stubEnv("PATH", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("adds the bridge as a local server in the V1 shape (accepted by V1 and V2)", () => {
    const config: ClientMcpConfig = {
      mcp: { existing: { type: "remote", url: "https://example.com/mcp" } },
    };

    expect(new OpenCodeStrategy().addGateway(config, 8850)).toEqual({
      $schema: OPENCODE_SCHEMA_URL,
      mcp: { existing: { type: "remote", url: "https://example.com/mcp" }, mcpsm: GATEWAY },
    });
  });

  it("keeps the V2 mcp.servers shape and other mcp settings", () => {
    const strategy = new OpenCodeStrategy();
    const existing = { type: "local", command: ["jbcontext", "mcp"], disabled: false };
    const config: ClientMcpConfig = {
      $schema: OPENCODE_SCHEMA_URL,
      mcp: { timeout: { catalog: 30000 }, servers: { jbcontext: existing } } as never,
    };

    const connected = strategy.addGateway(config, 8850);
    expect(connected.mcp).toEqual({
      timeout: { catalog: 30000 },
      servers: { jbcontext: existing, mcpsm: GATEWAY },
    });
    expect(strategy.hasGateway(connected)).toBe(true);
    expect(strategy.getGatewayKeys(connected)).toEqual(["mcpsm"]);
    expect(strategy.removeGateway(connected)).toEqual(config);
  });

  it("treats a V1 server named 'servers' as a server, not the V2 container", () => {
    const config: ClientMcpConfig = { mcp: { servers: { type: "remote", url: "https://x.test" } } };
    expect(new OpenCodeStrategy().addGateway(config, 8850).mcp).toEqual({
      servers: { type: "remote", url: "https://x.test" },
      mcpsm: GATEWAY,
    });
  });

  it("writes opencode.json, or the existing opencode.jsonc, in the global config folder", () => {
    const dir = path.join(root, "xdg", "opencode");
    const strategy = new OpenCodeStrategy();
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, "opencode.jsonc"), '{ // comment\n "shell": "zsh", }');
    expect(strategy.connect(8850).success).toBe(true);
    expect(strategy.readConfig()).toMatchObject({ shell: "zsh", mcp: { mcpsm: GATEWAY } });
    expect(fs.existsSync(path.join(dir, "opencode.json"))).toBe(false);

    // With both files, opencode.json wins
    fs.writeFileSync(path.join(dir, "opencode.json"), '{"mcp":{"servers":{}}}');
    expect(strategy.connect(8850).success).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "opencode.json"), "utf8")).mcp).toEqual({
      servers: { mcpsm: GATEWAY },
    });
    expect(fs.existsSync(path.join(dir, "config.json"))).toBe(false);
  });
});
