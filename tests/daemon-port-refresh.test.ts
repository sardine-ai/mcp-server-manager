import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const fetchHealth = vi.hoisted(() => vi.fn(async () => ({ status: "ok" })));
vi.mock("ofetch", () => ({ ofetch: fetchHealth }));

import { DaemonService } from "../src/services/daemon.service.js";
import { getConfigService, resetConfigService } from "../src/services/config.service.js";

describe("Daemon refresh after changing port", () => {
  let root: string;
  let service: DaemonService;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-daemon-port-"));
    vi.stubEnv("MCP_MANAGER_CONFIG_DIR", root);
    resetConfigService();
    getConfigService().setPort(9000);
    service = new DaemonService();
    vi.spyOn(service, "isDaemonRunning").mockReturnValue({ running: true, pid: 12345 });
    vi.spyOn(process, "kill").mockReturnValue(true);
    fetchHealth.mockResolvedValue({ status: "ok" });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetConfigService();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("discovers the old listener and checks health on the new port", async () => {
    expect(await service.refreshDaemon(service.getPortUpdateStatus(), true)).toEqual({
      success: true,
    });
    expect(service.isDaemonRunning).toHaveBeenCalled();
    expect(process.kill).toHaveBeenCalledWith(12345, "SIGHUP");
    expect(fetchHealth).toHaveBeenCalledWith("http://localhost:9000/health", expect.anything());
  });

  it("reports failure when the new port does not become healthy", async () => {
    fetchHealth.mockRejectedValueOnce(new Error("new port unavailable"));
    expect(await service.refreshDaemon(service.getPortUpdateStatus(), true)).toEqual({
      success: false,
      error: "Refresh signaled, but daemon readiness was not confirmed",
    });
  });

  it("retains the existing best-effort behavior for ordinary refreshes", async () => {
    fetchHealth.mockRejectedValueOnce(new Error("still refreshing"));
    expect(await service.refreshDaemon()).toEqual({ success: true });
  });

  it("does not signal or check health when the old listener is gone", async () => {
    vi.mocked(service.isDaemonRunning).mockReturnValue({ running: false });
    expect(await service.refreshDaemon(service.getPortUpdateStatus(), true)).toEqual({
      success: false,
      error: "Daemon is not running",
    });
    expect(process.kill).not.toHaveBeenCalled();
    expect(fetchHealth).not.toHaveBeenCalled();
  });
});
