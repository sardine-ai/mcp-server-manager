import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import TOML from "@iarna/toml";
import { CodexStrategy } from "../src/services/clients/codex.strategy.js";
import { ZedStrategy } from "../src/services/clients/zed.strategy.js";
import { updateGatewayAddresses } from "../src/services/clients/gateway-port.js";

describe("existing client gateway port updates", () => {
  let directory: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-client-port-"));
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  it("changes only existing managed addresses and keeps profile paths and extra fields", () => {
    const servers = {
      mcpsm: {
        command: "npx",
        args: ["supergateway", "--streamableHttp", "http://localhost:8850/mcp"],
        extra: true,
      },
      "mcpsm-dev": { url: "http://localhost:8850/mcp/dev", headers: { Test: "keep" } },
      unrelated: { url: "http://localhost:8850/mcp/other" },
    };
    expect(updateGatewayAddresses(servers, 9100)).toBe(true);
    expect(servers.mcpsm.args[2]).toBe("http://localhost:9100/mcp");
    expect(servers["mcpsm-dev"]).toEqual({
      url: "http://localhost:9100/mcp/dev",
      headers: { Test: "keep" },
    });
    expect(servers.unrelated.url).toBe("http://localhost:8850/mcp/other");
    expect(servers.mcpsm.extra).toBe(true);
    expect(updateGatewayAddresses(servers, 9100)).toBe(false);
    expect(Object.keys(servers)).toEqual(["mcpsm", "mcpsm-dev", "unrelated"]);
  });
  it("preserves raw Codex TOML fields during a port update", () => {
    const strategy = new CodexStrategy();
    const file = path.join(directory, "config.toml");
    strategy.paths.primary[
      process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux"
    ] = file;
    fs.writeFileSync(
      file,
      'model = "fixture"\n[mcp_servers.mcpsm-dev]\nurl = "http://localhost:8850/mcp/dev"\nstartup_timeout_sec = 90\n[mcp_servers.other]\ncommand = "node"\ncustom = true\n'
    );
    expect(strategy.updateGatewayPort(9100)).toMatchObject({ success: true });
    expect(TOML.parse(fs.readFileSync(file, "utf8"))).toEqual({
      model: "fixture",
      mcp_servers: {
        "mcpsm-dev": { url: "http://localhost:9100/mcp/dev", startup_timeout_sec: 90 },
        other: { command: "node", custom: true },
      },
    });
  });
  it("does not replace malformed client files or create disconnected gateways", () => {
    const strategy = new ZedStrategy();
    const file = path.join(directory, "settings.json");
    for (const platform of ["darwin", "linux", "win32"] as const)
      strategy.paths.primary[platform] = file;
    fs.writeFileSync(file, "{invalid");
    expect(strategy.updateGatewayPort(9100).success).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe("{invalid");
    fs.writeFileSync(file, '{"context_servers":{"other":{"url":"http://localhost:8850/mcp"}}}');
    const original = fs.readFileSync(file, "utf8");
    expect(strategy.updateGatewayPort(9100).success).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });
});
