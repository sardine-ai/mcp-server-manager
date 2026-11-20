import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  PROJECT_DIR_HEADER,
  resolveProjectDir,
  startGateway,
  stopGateway,
} from "../src/services/gateway.service.js";

const mocks = vi.hoisted(() => ({
  config: {
    reload: vi.fn(),
    getPort: vi.fn(() => 0),
    getSelectionState: vi.fn(() => ({ local: ["cwd"], remote: [] })),
    getLocalServers: vi.fn(() => [] as unknown[]),
    getRemoteServers: vi.fn(() => []),
    getToolFilters: vi.fn(() => ({})),
  },
  auth: { reload: vi.fn(), startProactiveRefresh: vi.fn(), stopProactiveRefresh: vi.fn() },
  profiles: {
    reload: vi.fn(),
    list: vi.fn(() => [{ id: "default" }]),
    getProfile: vi.fn(() => ({ servers: [], remoteServers: [] })),
  },
}));
vi.mock("../src/services/config.service.js", () => ({ getConfigService: () => mocks.config }));
vi.mock("../src/services/auth.service.js", () => ({ getAuthService: () => mocks.auth }));
vi.mock("../src/services/profile.service.js", () => ({ getProfileService: () => mocks.profiles }));

const fixture = path.resolve("tests/fixtures/cwd-server.mjs");

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function callCwd(client: Client): Promise<{ cwd: string; pid: number }> {
  const result = await client.callTool({ name: "cwd__cwd", arguments: {} });
  return JSON.parse((result.content as { text: string }[])[0].text);
}

async function waitForExit(pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

describe("resolveProjectDir", () => {
  it("returns the first existing absolute folder that is a project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-resolve-"));
    try {
      expect(resolveProjectDir(["${workspaceFolder}", "relative", dir])).toBe(dir);
      expect(resolveProjectDir([path.join(dir, "missing"), "/", os.homedir()])).toBeUndefined();
      expect(resolveProjectDir([undefined, path.join(dir, ".")])).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("gateway project folders", () => {
  let url: string;
  let projectDir: string;
  const clients: Client[] = [];

  beforeAll(async () => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-project-"));
    mocks.config.getPort.mockReturnValue(await freePort());
    mocks.config.getLocalServers.mockReturnValue([
      { id: "cwd", name: "cwd", command: process.execPath, args: [fixture] },
    ]);
    const started = await startGateway();
    expect(started).toEqual({ success: true });
    url = `http://localhost:${mocks.config.getPort()}/mcp`;
  });

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  });

  afterAll(async () => {
    await stopGateway();
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  async function connectHttp(headers?: Record<string, string>) {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: headers ? { headers } : undefined,
    });
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(transport);
    clients.push(client);
    return { client, transport };
  }

  it("runs local servers in the project folder sent by the client, once per project", async () => {
    const headers = { [PROJECT_DIR_HEADER]: encodeURIComponent(projectDir) };
    const first = await connectHttp(headers);
    const second = await connectHttp(headers);

    const a = await callCwd(first.client);
    const b = await callCwd(second.client);
    expect(a.cwd).toBe(fs.realpathSync(projectDir));
    expect(b.pid).toBe(a.pid);

    // The project's instance stops when its last session ends
    await first.transport.terminateSession();
    expect((await callCwd(second.client)).pid).toBe(a.pid);
    await second.transport.terminateSession();
    expect(await waitForExit(a.pid)).toBe(true);
  });

  it("keeps the daemon's shared instance for sessions without a project", async () => {
    const plain = await connectHttp();
    const invalid = await connectHttp({ [PROJECT_DIR_HEADER]: "%E0%A4%A" });
    const daemon = await callCwd(plain.client);
    expect(daemon.cwd).toBe(fs.realpathSync(process.cwd()));
    expect((await callCwd(invalid.client)).pid).toBe(daemon.pid);
  });

  it("passes the folder a client starts `mcpsm bridge` in", async () => {
    const tsx = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", tsx, path.resolve("src/cli/index.ts"), "bridge", url],
      cwd: projectDir,
      env: { ...process.env, MCP_MANAGER_CONFIG_DIR: path.join(projectDir, ".mcpsm") } as Record<
        string,
        string
      >,
    });
    const client = new Client({ name: "bridge-test", version: "1.0.0" });
    await client.connect(transport);

    const { cwd, pid } = await callCwd(client);
    expect(cwd).toBe(fs.realpathSync(projectDir));

    // Closing the client ends the bridge, which ends the gateway session
    await client.close();
    expect(await waitForExit(pid)).toBe(true);
  });
});
