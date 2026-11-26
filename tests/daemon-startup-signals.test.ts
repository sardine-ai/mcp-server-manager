import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

const serviceMocks = vi.hoisted(() => ({
  configService: {
    reload: vi.fn(),
    getPort: vi.fn(() => 0),
    getSelectionState: vi.fn(() => ({ local: [], remote: [] })),
    getLocalServers: vi.fn(() => []),
    getRemoteServers: vi.fn(() => []),
    getToolFilters: vi.fn(() => ({})),
  },
  authService: {
    reload: vi.fn(),
    startProactiveRefresh: vi.fn(),
    stopProactiveRefresh: vi.fn(),
  },
  envService: {
    getShellCommand: vi.fn(() => "/bin/sh"),
    expandHome: vi.fn((command: string) => command),
  },
  profileService: {
    reload: vi.fn(),
    list: vi.fn(() => []),
    getProfile: vi.fn(() => undefined),
  },
}));

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof serviceMocks.configService => serviceMocks.configService,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: (): typeof serviceMocks.authService => serviceMocks.authService,
}));

vi.mock("../src/services/environment.service.js", () => ({
  getEnvironmentService: (): typeof serviceMocks.envService => serviceMocks.envService,
}));

vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: (): typeof serviceMocks.profileService => serviceMocks.profileService,
}));

import {
  getGatewayStatus,
  resetGatewayStateForTests,
  runGatewayForeground,
  stopGateway,
} from "../src/services/gateway.service.js";

async function waitForStartupToFinish(): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !getGatewayStatus().running) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Could not reserve a port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

describe("foreground gateway signals", () => {
  let handlers: Map<string, () => void>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetGatewayStateForTests();
    handlers = new Map();
    serviceMocks.configService.getPort.mockReturnValue(await freePort());

    // Capture the listeners instead of emitting signals: emitting would also reach
    // vitest's own process listeners
    vi.spyOn(process, "on").mockImplementation(((event: string, listener: () => void) => {
      handlers.set(event, listener);
      return process;
    }) as unknown as typeof process.on);
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    // A test may leave startGateway in flight. Let it finish before stopping, or it marks the
    // reset state as running and the next test starts against a "running" gateway
    await waitForStartupToFinish();
    await stopGateway();
    vi.restoreAllMocks();
    resetGatewayStateForTests();
  });

  it("registers handlers before publishing the PID", async () => {
    let handlerCountWhenPublished = -1;
    void runGatewayForeground(undefined, {
      onSignalsReady: () => {
        handlerCountWhenPublished = handlers.size;
      },
    });

    expect(handlerCountWhenPublished).toBeGreaterThan(0);
    expect(handlers.has("SIGHUP")).toBe(true);
    expect(handlers.has("SIGTERM")).toBe(true);

    await waitForStartupToFinish();
    expect(getGatewayStatus().running).toBe(true);
  });

  it("survives a refresh that arrives during startup, then applies it", async () => {
    void runGatewayForeground();

    handlers.get("SIGHUP")?.();

    expect(exitSpy).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(serviceMocks.configService.reload).toHaveBeenCalledTimes(1));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("shuts down cleanly and only once when interrupted during startup", async () => {
    void runGatewayForeground();

    const terminate = handlers.get("SIGTERM");
    expect(terminate).toBeDefined();
    terminate?.();
    terminate?.();

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    expect(serviceMocks.authService.stopProactiveRefresh).toHaveBeenCalledTimes(1);
  });

  it("applies a refresh sent after the gateway is listening", async () => {
    void runGatewayForeground();
    await waitForStartupToFinish();

    handlers.get("SIGHUP")?.();

    await vi.waitFor(() => expect(serviceMocks.configService.reload).toHaveBeenCalledTimes(1));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  // The gateway starts local servers through a POSIX login shell
  it.skipIf(process.platform === "win32")(
    "applies a tool filter sent during startup without restarting the servers",
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-sigusr1-"));
      const pidFile = path.join(dir, "server.pid");
      const fixture = path.resolve("tests/fixtures/cwd-server.mjs");

      try {
        serviceMocks.configService.getPort.mockReturnValue(await freePort());
        serviceMocks.configService.getSelectionState.mockReturnValue({
          local: ["cwd"],
          remote: [],
        });
        serviceMocks.configService.getLocalServers.mockReturnValue([
          {
            id: "cwd",
            name: "cwd",
            command: process.execPath,
            args: [fixture],
            env: { PID_FILE: pidFile },
          },
        ]);
        serviceMocks.configService.getToolFilters.mockReturnValue({});

        void runGatewayForeground();

        // Sent while the servers are still connecting: it has to wait for the gateway
        handlers.get("SIGUSR1")?.();
        expect(exitSpy).not.toHaveBeenCalled();

        await waitForStartupToFinish();
        // The queued refresh runs once the gateway is up: refreshGatewayTools reloads the
        // config only when it gets that far, so a reload proves it was not dropped
        await vi.waitFor(() => expect(serviceMocks.configService.reload).toHaveBeenCalled());
        expect(getGatewayStatus().toolCount).toBe(2);
        const pid = fs.readFileSync(pidFile, "utf8");

        // Disabling a tool now must reach the running servers, not need a restart
        serviceMocks.configService.getToolFilters.mockReturnValue({
          cwd: { disabledTools: ["shared_only"] },
        });
        handlers.get("SIGUSR1")?.();

        await vi.waitFor(() => expect(getGatewayStatus().toolCount).toBe(1));
        expect(fs.readFileSync(pidFile, "utf8")).toBe(pid);
        expect(exitSpy).not.toHaveBeenCalled();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
