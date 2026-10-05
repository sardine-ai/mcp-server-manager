import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getGatewayStatus,
  refreshGateway,
  resetGatewayStateForTests,
  setGatewayStateForTests,
} from "../src/services/gateway.service.js";

const mockConfigService = {
  reload: vi.fn(),
  getPort: vi.fn(() => 8850),
  getSelectionState: vi.fn(() => ({ local: [], remote: [] })),
  getLocalServers: vi.fn(() => []),
  getRemoteServers: vi.fn(() => []),
};

const mockAuthService = {
  reload: vi.fn(),
};

const mockProfileService = {
  reload: vi.fn(),
  list: vi.fn(() => []),
  getServersForProfile: vi.fn(() => null),
};

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof mockConfigService => mockConfigService,
}));

vi.mock("../src/services/auth.service.js", () => ({
  getAuthService: (): typeof mockAuthService => mockAuthService,
}));

vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: (): typeof mockProfileService => mockProfileService,
}));

describe("GatewayService", () => {
  beforeEach(() => {
    resetGatewayStateForTests();
    vi.clearAllMocks();
  });

  it("reports stopped status by default", () => {
    const status = getGatewayStatus();
    expect(status.running).toBe(false);
    expect(status.toolCount).toBe(0);
    expect(status.serverCount).toBe(0);
  });

  it("returns an error when refreshing while stopped", async () => {
    const result = await refreshGateway();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not running/i);
  });

  it("re-binds the HTTP server when port changes on refresh", async () => {
    const close = vi.fn((cb: (err?: Error | null) => void) => cb(null));
    const listen = vi.fn((_port: number, _host: string, cb: () => void) => cb());
    const mockServer = {
      close,
      listen,
      once: vi.fn(),
      off: vi.fn(),
    };

    setGatewayStateForTests({
      running: true,
      port: 3000,
      httpServer: mockServer as unknown as typeof mockServer,
      connectedServers: new Map(),
      toolToServerMap: new Map(),
      aggregatedTools: [],
      activeSelection: new Set(),
    });

    mockConfigService.getPort.mockReturnValue(4000);

    const result = await refreshGateway();

    expect(result.success).toBe(true);
    expect(close).toHaveBeenCalled();
    expect(listen).toHaveBeenCalledWith(4000, "127.0.0.1", expect.any(Function));
    expect(getGatewayStatus().port).toBe(4000);
    expect(mockAuthService.reload).toHaveBeenCalled();
    expect(mockConfigService.reload).toHaveBeenCalled();
  });
});
