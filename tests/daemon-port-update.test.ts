import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "child_process";
import { DaemonService } from "../src/services/daemon.service.js";

const config = vi.hoisted(() => ({ directory: "", port: 9100 }));
vi.mock("../src/services/config.service.js", () => ({
  getConfigService: () => ({
    getPaths: () => ({ configDir: config.directory }),
    getPort: () => config.port,
  }),
}));
vi.mock("child_process", () => ({ execSync: vi.fn() }));

describe("daemon discovery during a port retry", () => {
  beforeEach(() => {
    config.directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-daemon-port-"));
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(config.directory, { recursive: true, force: true });
  });

  it("finds the saved daemon independently of the configured listener port", () => {
    const file = path.join(config.directory, "daemon.pid");
    fs.writeFileSync(file, "123");
    vi.mocked(execSync).mockReturnValue(
      "node /fixture/dist/cli/index.js daemon start --foreground"
    );
    const daemon = new DaemonService();
    const listenerLookup = vi.spyOn(daemon, "isDaemonRunning");

    expect(daemon.getPortUpdateStatus()).toEqual({ running: true, pid: 123 });
    expect(listenerLookup).not.toHaveBeenCalled();
    expect(fs.readFileSync(file, "utf8")).toBe("123");
  });

  it("does not use a saved PID belonging to an unrelated process", () => {
    fs.writeFileSync(path.join(config.directory, "daemon.pid"), "123");
    vi.mocked(execSync).mockReturnValue("node /fixture/other-server.js");
    const daemon = new DaemonService();
    vi.spyOn(daemon, "isDaemonRunning").mockReturnValue({ running: false });
    expect(daemon.getPortUpdateStatus()).toEqual({ running: false });
  });
});
