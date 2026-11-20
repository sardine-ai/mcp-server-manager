import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  PROJECT_DIR_HEADER,
  rejectRequestSource,
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
  origins: [] as string[],
}));
vi.mock("../src/services/config.service.js", () => ({ getConfigService: () => mocks.config }));
vi.mock("../src/services/auth.service.js", () => ({ getAuthService: () => mocks.auth }));
vi.mock("../src/services/profile.service.js", () => ({ getProfileService: () => mocks.profiles }));
vi.mock("../src/services/settings.service.js", () => ({ getAllowedOrigins: () => mocks.origins }));

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

describe("gateway HTTP endpoint", () => {
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
    const names = (await plain.client.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(["cwd__cwd", "cwd__shared_only"]);
  });

  it("switches a project session to the tools its project's instance offers", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-tools-"));
    fs.writeFileSync(path.join(project, ".fixture-project"), "");
    try {
      const { client } = await connectHttp({ [PROJECT_DIR_HEADER]: encodeURIComponent(project) });
      const changed = new Promise<void>((resolve) =>
        client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve())
      );
      // Shared tools until the project's instance has started, then a list_changed
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
        "cwd__shared_only"
      );
      await changed;
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        "cwd__cwd",
        "cwd__project_only",
      ]);
      expect(await client.callTool({ name: "cwd__project_only", arguments: {} })).toMatchObject({
        content: [{ text: "project" }],
      });

      // A tool listed before the switch gets an explanation, not "Unknown tool"
      const stale = await client.callTool({ name: "cwd__shared_only", arguments: {} });
      expect(stale.isError).toBe(true);
      expect((stale.content as { text: string }[])[0].text).toBe(
        `cwd__shared_only is not available in ${project}: cwd does not offer it there. Reload the tool list for this project's tools.`
      );
      expect((await client.callTool({ name: "cwd__nope", arguments: {} })).content).toMatchObject([
        { text: "Unknown tool: cwd__nope" },
      ]);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("passes the folder a client starts `mcpsm bridge` in, and its tool changes", async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-bridge-"));
    fs.writeFileSync(path.join(project, ".fixture-project"), "");
    const tsx = pathToFileURL(path.resolve("node_modules/tsx/dist/loader.mjs")).href;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", tsx, path.resolve("src/cli/index.ts"), "bridge", url],
      cwd: project,
      env: { ...process.env, MCP_MANAGER_CONFIG_DIR: path.join(project, ".mcpsm") } as Record<
        string,
        string
      >,
    });
    const client = new Client({ name: "bridge-test", version: "1.0.0" });
    const changed = new Promise<void>((resolve) =>
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => resolve())
    );
    try {
      await client.connect(transport);
      await changed;
      expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
        "cwd__project_only"
      );

      const { cwd, pid } = await callCwd(client);
      expect(cwd).toBe(fs.realpathSync(project));

      // Closing the client ends the bridge, which ends the gateway session
      await client.close();
      expect(await waitForExit(pid)).toBe(true);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  describe("request sources", () => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "raw", version: "1.0.0" },
      },
    });

    afterEach(() => {
      mocks.origins = [];
    });

    // node:http, because fetch does not let callers set Host
    function send(
      method: string,
      headers: Record<string, string>
    ): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
      const { port } = new URL(url);
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port,
            path: "/mcp",
            method,
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              ...headers,
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
          }
        );
        req.on("error", reject);
        req.end(method === "POST" ? initialize : undefined);
      });
    }

    it("rejects web pages whose Origin is not allowlisted", async () => {
      const origin = "https://evil.example";
      for (const method of ["POST", "OPTIONS"]) {
        const res = await send(method, { host: "localhost", origin });
        expect(res.status).toBe(403);
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      }
    });

    it("rejects a non-local Host (DNS rebinding)", async () => {
      expect((await send("POST", { host: "evil.example:8850" })).status).toBe(403);
    });

    it("accepts clients without an Origin, and allowlisted origins with CORS headers", async () => {
      const plain = await send("POST", { host: "127.0.0.1" });
      expect(plain.status).toBe(200);
      expect(plain.headers["access-control-allow-origin"]).toBeUndefined();

      mocks.origins = ["http://localhost:6274"];
      const origin = "http://localhost:6274";
      const preflight = await send("OPTIONS", { host: "localhost", origin });
      expect(preflight.status).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
      const allowed = await send("POST", { host: "localhost", origin });
      expect(allowed.status).toBe(200);
      expect(allowed.headers["access-control-expose-headers"]).toBe("mcp-session-id");
    });

    it("only allows local Host names", () => {
      for (const host of ["localhost:8850", "127.0.0.1:8850", "[::1]:8850", "localhost"]) {
        expect(rejectRequestSource(host)).toBeNull();
      }
      for (const host of [undefined, "", "evil.example", "127.0.0.1.nip.io:8850", "0.0.0.0:8850"]) {
        expect(rejectRequestSource(host)).toMatch(/Host not allowed/);
      }
      expect(rejectRequestSource("localhost", "null")).toMatch(/Origin not allowed/);
    });
  });
});
