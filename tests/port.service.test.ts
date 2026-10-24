import { beforeEach, describe, expect, it, vi } from "vitest";
import { changeGatewayPort } from "../src/services/gateway-port.service.js";

const mocks = vi.hoisted(() => ({
  port: 8850,
  setPort: vi.fn(),
  clients: vi.fn(),
  status: vi.fn(),
  health: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../src/services/config.service.js", () => ({
  getConfigService: vi.fn(() => ({ getPort: vi.fn(() => mocks.port), setPort: mocks.setPort })),
}));
vi.mock("../src/services/clients/index.js", () => ({
  getRegisteredClientIds: () => ["codex"],
  getClientStrategy: () => ({
    getEffectiveConfigPath: () => "/client-config",
    readConfigForUpdate: () => ({}),
    updateGatewayPort: mocks.clients,
  }),
}));
vi.mock("../src/services/project-connections.service.js", () => ({
  ProjectConnectionsService: class {
    list() {
      return [];
    }
  },
}));
vi.mock("../src/services/daemon.service.js", () => ({
  getDaemonService: vi.fn(() => ({
    getPortUpdateStatus: mocks.status,
    checkHealth: mocks.health,
    refreshDaemon: mocks.refresh,
  })),
}));

describe("gateway port coordination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.port = 8850;
    mocks.setPort.mockImplementation((port: number) => {
      mocks.port = port;
      return { success: true };
    });
    mocks.clients.mockReturnValue({ success: true });
    mocks.status.mockReturnValue({ running: false });
    mocks.health.mockResolvedValue({ status: "ok" });
    mocks.refresh.mockResolvedValue({ success: true });
  });
  it.each(["9000abc", "9000.2", "", [9000], true, 0, 65536, NaN])(
    "rejects %j before external effects",
    async (value) => {
      await expect(Reflect.apply(changeGatewayPort, undefined, [value])).resolves.toMatchObject({
        success: false,
        port: 8850,
      });
      expect(mocks.setPort).not.toHaveBeenCalled();
      expect(mocks.clients).not.toHaveBeenCalled();
      expect(mocks.status).not.toHaveBeenCalled();
    }
  );
  it("updates a stopped daemon's configuration without starting it", async () => {
    await expect(changeGatewayPort(9100)).resolves.toMatchObject({ success: true, port: 9100 });
    expect(mocks.clients).toHaveBeenCalledWith(9100);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("captures daemon identity before persistence and requires confirmed readiness", async () => {
    mocks.status.mockImplementation(() => {
      expect(mocks.port).toBe(8850);
      return { running: true, pid: 123 };
    });
    mocks.refresh.mockResolvedValue({ success: false, error: "readiness timed out" });
    mocks.clients.mockReturnValue({ success: false, error: "read only" });
    await expect(changeGatewayPort(9100)).resolves.toMatchObject({
      success: false,
      port: 9100,
      warnings: [
        expect.stringContaining("read only"),
        expect.stringContaining("readiness timed out"),
      ],
    });
    expect(mocks.refresh).toHaveBeenCalledWith({ running: true, pid: 123 }, true);
    expect(mocks.port).toBe(9100);
  });
  it("does not update targets when persistence fails", async () => {
    mocks.setPort.mockImplementationOnce(() => {
      throw new Error("write failed");
    });
    await expect(changeGatewayPort(9100)).resolves.toMatchObject({ success: false, port: 8850 });
    expect(mocks.clients).not.toHaveBeenCalled();
  });

  it("retries a daemon refresh when the requested port was already saved", async () => {
    mocks.status.mockReturnValue({ running: true, pid: 123 });
    mocks.refresh.mockResolvedValueOnce({ success: false, error: "refresh failed" });
    await expect(changeGatewayPort(9100)).resolves.toMatchObject({ success: false, port: 9100 });

    mocks.health.mockResolvedValue({ status: "error" });
    await expect(changeGatewayPort(9100)).resolves.toMatchObject({ success: true, port: 9100 });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenLastCalledWith({ running: true, pid: 123 }, true);
  });
  it("serializes updates and can repair clients on a same-port retry", async () => {
    let ready: (() => void) | undefined;
    mocks.status.mockReturnValue({ running: true, pid: 123 });
    mocks.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ready = (): void => resolve({ success: true });
        })
    );
    const first = changeGatewayPort(9100);
    const second = changeGatewayPort(9200);
    await vi.waitFor(() => expect(ready).toBeDefined());
    expect(mocks.port).toBe(9100);
    ready?.();
    await Promise.all([first, second]);
    expect(mocks.clients.mock.calls).toEqual([[9100], [9200]]);
    mocks.refresh.mockClear();
    await changeGatewayPort(9200);
    expect(mocks.clients).toHaveBeenLastCalledWith(9200);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
