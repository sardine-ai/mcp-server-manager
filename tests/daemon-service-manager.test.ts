import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const execSync = vi.hoisted(() => vi.fn((_command: string, _options?: unknown) => ""));
const spawn = vi.hoisted(() => vi.fn(() => ({ pid: 4321, unref: vi.fn() })));
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  execSync,
  spawn,
}));

import { DaemonService } from "../src/services/daemon.service.js";
import { resetConfigService } from "../src/services/config.service.js";

const LABEL = /^launchctl (bootout|kickstart) gui\/-?\d+\/com\.mcpsm\.gateway$/;

describe("Daemon start/stop with auto-start installed", () => {
  let root: string;
  let service: DaemonService;
  const platform = process.platform;
  const commands = () => execSync.mock.calls.map(([command]) => command);

  /** A DaemonService for `dir`, as if run with MCP_MANAGER_CONFIG_DIR=dir */
  const serviceFor = (dir: string) => {
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", path.join(root, dir));
    resetConfigService();
    return new DaemonService();
  };

  /** Enable auto-start for `svc` on `os`, writing the unit/plist under the fake home */
  const enableOn = (svc: DaemonService, os_: typeof process.platform) => {
    Object.defineProperty(process, "platform", { value: os_ });
    expect(svc.enableStartup()).toEqual({ success: true });
    execSync.mockClear();
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-daemon-svc-"));
    vi.spyOn(os, "homedir").mockReturnValue(root);
    execSync.mockReset().mockReturnValue("");
    spawn.mockClear();
    service = serviceFor("default");
    enableOn(service, "darwin");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: platform });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetConfigService();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("starts through launchd instead of spawning a second gateway", async () => {
    expect(await service.startDaemon()).toEqual({ success: true });
    const launchctl = commands().filter((c) => c.startsWith("launchctl"));
    expect(launchctl[0]).toMatch(/^launchctl bootstrap gui\/-?\d+ ".*com\.mcpsm\.gateway\.plist"$/);
    expect(launchctl[1]).toMatch(LABEL);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("boots the job out on stop so KeepAlive doesn't respawn it", async () => {
    expect(await service.stopDaemon()).toEqual({ success: true });
    expect(commands()[0]).toMatch(LABEL);
    expect(commands()[0]).toContain("bootout");
  });

  it("falls back to spawning when launchd can't start it", async () => {
    execSync.mockImplementation((command: string) => {
      if (command.startsWith("launchctl")) throw new Error("launchctl failed");
      return "";
    });
    expect(await service.startDaemon()).toEqual({ success: true, pid: 4321 });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("leaves another config dir's LaunchAgent alone", async () => {
    const other = serviceFor("other");
    expect(await other.startDaemon()).toEqual({ success: true, pid: 4321 });
    expect(await other.stopDaemon()).toEqual({ success: true });
    expect(commands().filter((c) => c.startsWith("launchctl"))).toEqual([]);
  });

  it("runs the LaunchAgent with the config dir it was enabled from", () => {
    const plist = fs.readFileSync(
      path.join(root, "Library/LaunchAgents/com.mcpsm.gateway.plist"),
      "utf8"
    );
    expect(plist).toContain(
      `<key>MCP_MANAGER_CONFIG_DIR</key>\n        <string>${path.join(root, "default")}</string>`
    );
  });

  it("uses systemd on Linux and appends its output to the gateway log", async () => {
    enableOn(service, "linux");
    const unit = fs.readFileSync(path.join(root, ".config/systemd/user/mcpsm.service"), "utf8");
    expect(unit).toContain(`StandardOutput=append:${service.getLogFilePath()}\n`);
    expect(unit).toContain(`Environment="MCP_MANAGER_CONFIG_DIR=${path.join(root, "default")}"`);

    expect(await service.startDaemon()).toEqual({ success: true });
    expect(commands()).toContain("systemctl --user start mcpsm");
    expect(spawn).not.toHaveBeenCalled();
    expect(await service.stopDaemon()).toEqual({ success: true });
    expect(commands()).toContain("systemctl --user stop mcpsm");
  });
});
