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

describe("Daemon start/stop with a LaunchAgent installed", () => {
  let root: string;
  let service: DaemonService;
  const platform = process.platform;
  const commands = () => execSync.mock.calls.map(([command]) => command);

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-daemon-svc-"));
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", root);
    resetConfigService();
    Object.defineProperty(process, "platform", { value: "darwin" });
    service = new DaemonService();
    vi.spyOn(service, "isStartupEnabled").mockReturnValue(true);
    execSync.mockReset().mockReturnValue("");
    spawn.mockClear();
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
});
