import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import type { LocalServer } from "../src/types/index.js";

const mocks = vi.hoisted(() => ({
  config: {
    reload: vi.fn(),
    getPort: vi.fn(() => 0),
    getSelectionState: vi.fn(() => ({ local: ["silent"], remote: [] })),
    getLocalServers: vi.fn(() => [] as LocalServer[]),
    getRemoteServers: vi.fn(() => []),
    getToolFilters: vi.fn(() => ({})),
  },
  auth: { reload: vi.fn(), startProactiveRefresh: vi.fn(), stopProactiveRefresh: vi.fn() },
  profiles: { reload: vi.fn(), list: vi.fn(() => []), getProfile: vi.fn(() => undefined) },
}));

vi.mock("../src/services/config.service.js", () => ({ getConfigService: () => mocks.config }));
vi.mock("../src/services/auth.service.js", () => ({ getAuthService: () => mocks.auth }));
vi.mock("../src/services/profile.service.js", () => ({ getProfileService: () => mocks.profiles }));

import {
  getGatewayStatus,
  resetGatewayStateForTests,
  startGateway,
  stopGateway,
} from "../src/services/gateway.service.js";

const fixture = path.resolve("tests/fixtures/silent-server.mjs");
const itLocal = it.skipIf(process.platform === "win32");

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForFile(file: string): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${file} was never written`);
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

describe("stopping a gateway that is still starting", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await stopGateway();
    resetGatewayStateForTests();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  itLocal("stops the local servers it started, and never binds the port", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-startup-cancel-"));
    dirs.push(dir);
    const pidFile = path.join(dir, "server.pid");
    const port = await freePort();

    mocks.config.getPort.mockReturnValue(port);
    mocks.config.getLocalServers.mockReturnValue([
      {
        id: "silent",
        name: "silent",
        command: process.execPath,
        args: [fixture],
        env: { PID_FILE: pidFile },
      },
    ]);

    // The fixture never answers the handshake, so the startup stays in flight
    const starting = startGateway();
    const pid = Number(await waitForFile(pidFile));
    expect(getGatewayStatus().running).toBe(false);

    await stopGateway();

    // Closing the pending transport ends the child and releases the startup. Racing a timeout
    // keeps a regression as a failure instead of a hung test.
    await expect(
      Promise.race([
        starting,
        new Promise((resolve) => setTimeout(() => resolve("still connecting"), 5000)),
      ])
    ).resolves.toEqual({ success: false, error: "Startup was cancelled" });
    expect(await waitForExit(pid)).toBe(true);
    expect(getGatewayStatus().running).toBe(false);
  });
});
