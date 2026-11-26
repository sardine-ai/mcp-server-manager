import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: () => ({ getPort: () => 8850 }),
}));

import { resolveGatewayUrl } from "../src/cli/commands/bridge.cmd.js";
import { commandRunsMcpsmDaemon } from "../src/services/daemon.service.js";

describe("bridge gateway URL", () => {
  it("always talks to the local gateway, whatever host the client config names", () => {
    expect(resolveGatewayUrl("https://attacker.example/mcp/work").origin).toBe(
      "http://127.0.0.1:8850"
    );
    expect(resolveGatewayUrl("https://attacker.example/mcp/work").pathname).toBe("/mcp/work");
    expect(resolveGatewayUrl("http://127.0.0.1.nip.io:8850/mcp").pathname).toBe("/mcp");
  });

  it("serves every server when the target names no profile", () => {
    expect(resolveGatewayUrl().pathname).toBe("/mcp");
    expect(resolveGatewayUrl("http://localhost:8850/mcp").pathname).toBe("/mcp");
  });

  it("refuses a target it cannot read as a profile", () => {
    expect(() => resolveGatewayUrl("http://localhost:8850/other/work")).toThrow();
    expect(() => resolveGatewayUrl("not a url")).toThrow();
  });
});

describe("daemon process identification", () => {
  it("recognises the gateway whatever path it was launched from", () => {
    expect(commandRunsMcpsmDaemon("mcpsm daemon start --foreground")).toBe(true);
    expect(
      commandRunsMcpsmDaemon(
        "node /usr/local/lib/node_modules/mcp-server-manager/dist/cli/index.js daemon start --foreground"
      )
    ).toBe(true);
    expect(
      commandRunsMcpsmDaemon("node --import tsx src/cli/index.ts daemon start --foreground")
    ).toBe(true);
  });

  it("does not mistake another app on the port for the daemon", () => {
    expect(commandRunsMcpsmDaemon("node /tmp/vite/bin/vite.js --port 8850")).toBe(false);
    expect(commandRunsMcpsmDaemon("python3 -m http.server 8850")).toBe(false);
    expect(commandRunsMcpsmDaemon("mcpsm daemon start")).toBe(false);
  });
});
