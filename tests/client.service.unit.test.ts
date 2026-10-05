import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import type { IClientStrategy } from "../src/types/client-strategy.types.js";
import type { ClientId, ClientMcpConfig, ClientStatus } from "../src/types/index.js";

const clientMocks = vi.hoisted(() => {
  const strategy = {
    metadata: {
      id: "mock",
      displayName: "Mock Client",
      description: "Mock client",
    },
    getPrimaryConfigPath: vi.fn(() => "/tmp/mock-client.json"),
    getSecondaryConfigPath: vi.fn(() => "/tmp/mock-client-secondary.json"),
    isInstalled: vi.fn(() => true),
    readConfig: vi.fn(() => ({ mcpServers: {} })),
    writeConfig: vi.fn(() => true),
    getStatus: vi.fn(() => "connected"),
    getServerCount: vi.fn(() => 3),
    connect: vi.fn(() => ({ success: true })),
    disconnect: vi.fn(() => ({ success: true })),
  };

  return {
    strategy,
    getClientStrategy: vi.fn((clientId: ClientId) => (clientId === "mock" ? strategy : null)),
    getRegisteredClientIds: vi.fn(() => ["mock", "missing"]),
    clearStrategyCache: vi.fn(),
  };
});

const configServiceMocks = vi.hoisted(() => ({
  configService: {
    getPort: vi.fn(() => 8850),
  },
}));

const profileServiceMocks = vi.hoisted(() => ({
  profileService: {
    list: vi.fn(() => [
      { id: "dev", name: "Development", serverCount: 0, active: false },
      { id: "prod", name: "Production", serverCount: 0, active: false },
    ]),
  },
}));

const spawnSyncMock = vi.hoisted(() => vi.fn(() => ({ status: 0 })));

vi.mock("../src/services/clients/index.js", () => ({
  getClientStrategy: clientMocks.getClientStrategy,
  getRegisteredClientIds: clientMocks.getRegisteredClientIds,
  clearStrategyCache: clientMocks.clearStrategyCache,
}));

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: (): typeof configServiceMocks.configService => configServiceMocks.configService,
}));

vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: (): typeof profileServiceMocks.profileService =>
    profileServiceMocks.profileService,
}));

vi.mock("child_process", () => ({
  spawnSync: spawnSyncMock,
}));

import {
  ClientService,
  getClientService,
  resetClientService,
} from "../src/services/client.service.js";

function mockStrategy(): IClientStrategy {
  return clientMocks.strategy as unknown as IClientStrategy;
}

describe("ClientService facade", () => {
  let service: ClientService;
  let tempDir: string;
  const originalEditor = process.env.EDITOR;
  const originalVisual = process.env.VISUAL;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-client-service-test-"));
    service = new ClientService();
    vi.clearAllMocks();
    clientMocks.getClientStrategy.mockImplementation((clientId: ClientId) =>
      clientId === "mock" ? clientMocks.strategy : null
    );
    clientMocks.getRegisteredClientIds.mockReturnValue(["mock", "missing"]);
    configServiceMocks.configService.getPort.mockReturnValue(8850);
    profileServiceMocks.profileService.list.mockReturnValue([
      { id: "dev", name: "Development", serverCount: 0, active: false },
      { id: "prod", name: "Production", serverCount: 0, active: false },
    ]);
    mockStrategy().getPrimaryConfigPath = vi.fn(() => path.join(tempDir, "mock-client.json"));
    mockStrategy().getSecondaryConfigPath = vi.fn(() => path.join(tempDir, "secondary.json"));
    mockStrategy().isInstalled = vi.fn(() => true);
    mockStrategy().readConfig = vi.fn(() => ({ mcpServers: {} }));
    mockStrategy().writeConfig = vi.fn(() => true);
    mockStrategy().getStatus = vi.fn(() => "connected" as ClientStatus);
    mockStrategy().getServerCount = vi.fn(() => 3);
    mockStrategy().connect = vi.fn(() => ({ success: true }));
    mockStrategy().disconnect = vi.fn(() => ({ success: true }));
    process.env.EDITOR = "test-editor";
    delete process.env.VISUAL;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetClientService();
    if (originalEditor === undefined) {
      delete process.env.EDITOR;
    } else {
      process.env.EDITOR = originalEditor;
    }
    if (originalVisual === undefined) {
      delete process.env.VISUAL;
    } else {
      process.env.VISUAL = originalVisual;
    }
  });

  it("delegates path, display name, install, read, and write calls to client strategies", () => {
    const config: ClientMcpConfig = { mcpServers: { docs: { command: "node" } } };

    expect(service.getClientConfigPath("mock" as ClientId)).toBe(
      path.join(tempDir, "mock-client.json")
    );
    expect(service.getClientConfigPath("missing" as ClientId)).toBeNull();
    expect(service.getClientName("mock" as ClientId)).toBe("Mock Client");
    expect(service.getClientName("missing" as ClientId)).toBe("missing");
    expect(service.getSupportedClients()).toEqual(["mock", "missing"]);
    expect(service.isClientInstalled("mock" as ClientId)).toBe(true);
    expect(service.isClientInstalled("missing" as ClientId)).toBe(false);
    expect(service.readClientConfig("mock" as ClientId)).toEqual({ mcpServers: {} });
    expect(service.readClientConfig("missing" as ClientId)).toBeNull();
    expect(service.writeClientConfig("mock" as ClientId, config)).toBe(true);
    expect(service.writeClientConfig("missing" as ClientId, config)).toBe(false);
    expect(mockStrategy().writeConfig).toHaveBeenCalledWith(config);
  });

  it("detects registered clients and skips missing strategies", () => {
    const clients = service.detectClients("dev");

    expect(clients).toEqual([
      {
        id: "mock",
        name: "Mock Client",
        configPath: path.join(tempDir, "mock-client.json"),
        mcpConfigPath: path.join(tempDir, "secondary.json"),
        installed: true,
        hasConfig: true,
        status: "connected",
        serverCount: 3,
      },
    ]);
    expect(mockStrategy().getStatus).toHaveBeenCalledWith(process.platform, "dev");
  });

  it("connects and disconnects one client through the current gateway port", () => {
    expect(service.connectClient("missing" as ClientId)).toEqual({
      success: false,
      error: "Unknown client",
    });
    expect(service.connectClient("mock" as ClientId, "dev")).toEqual({ success: true });
    expect(mockStrategy().connect).toHaveBeenCalledWith(8850, "dev");

    expect(service.disconnectClient("missing" as ClientId)).toEqual({
      success: false,
      error: "Unknown client",
    });
    expect(service.disconnectClient("mock" as ClientId, "dev")).toEqual({ success: true });
    expect(mockStrategy().disconnect).toHaveBeenCalledWith("dev");
  });

  it("connects every profile and reports per-profile failures", () => {
    mockStrategy().connect = vi.fn((_port: number, profileId?: string) =>
      profileId === "prod" ? { success: false, error: "denied" } : { success: true }
    );

    expect(service.connectAllProfiles("mock" as ClientId)).toEqual({
      succeeded: ["dev"],
      failed: [{ id: "prod", error: "denied" }],
    });
    expect(mockStrategy().connect).toHaveBeenCalledWith(8850, "dev");
    expect(mockStrategy().connect).toHaveBeenCalledWith(8850, "prod");
    expect(service.connectAllProfiles("missing" as ClientId)).toEqual({
      succeeded: [],
      failed: [{ id: "*", error: "Unknown client" }],
    });
  });

  it("disconnects the bare gateway and every profile", () => {
    mockStrategy().disconnect = vi.fn((profileId?: string) =>
      profileId === "prod" ? { success: false } : { success: true }
    );

    expect(service.disconnectAllProfiles("mock" as ClientId)).toEqual({
      succeeded: ["dev"],
      failed: [{ id: "prod", error: "Unknown error" }],
    });
    expect(mockStrategy().disconnect).toHaveBeenCalledWith();
    expect(mockStrategy().disconnect).toHaveBeenCalledWith("dev");
    expect(mockStrategy().disconnect).toHaveBeenCalledWith("prod");
    expect(service.disconnectAllProfiles("missing" as ClientId)).toEqual({
      succeeded: [],
      failed: [{ id: "*", error: "Unknown client" }],
    });
  });

  it("reports connection status and client existence", () => {
    expect(service.getConnectionStatus("mock" as ClientId, "dev")).toBe("connected");
    expect(service.getConnectionStatus("missing" as ClientId)).toBe("not-installed");
    expect(service.clientExists("mock")).toBe(true);
    expect(service.clientExists("missing")).toBe(false);
  });

  it("opens existing client configs in the configured editor", () => {
    const configPath = path.join(tempDir, "mock-client.json");
    fs.writeFileSync(configPath, "{}");
    mockStrategy().getPrimaryConfigPath = vi.fn(() => configPath);

    expect(service.openClientConfig("mock" as ClientId)).toEqual({ success: true });
    expect(spawnSyncMock).toHaveBeenCalledWith("test-editor", [configPath], {
      stdio: "inherit",
    });
  });

  it("reports open-client-config failures", () => {
    mockStrategy().getPrimaryConfigPath = vi.fn(() => path.join(tempDir, "missing.json"));
    expect(service.openClientConfig("mock" as ClientId)).toEqual({
      success: false,
      error: "Config file does not exist",
    });

    expect(service.openClientConfig("missing" as ClientId)).toEqual({
      success: false,
      error: "Unknown client",
    });

    const configPath = path.join(tempDir, "mock-client.json");
    fs.writeFileSync(configPath, "{}");
    mockStrategy().getPrimaryConfigPath = vi.fn(() => configPath);
    spawnSyncMock.mockImplementationOnce(() => {
      throw new Error("editor failed");
    });

    expect(service.openClientConfig("mock" as ClientId)).toEqual({
      success: false,
      error: "editor failed",
    });
  });

  it("resets singleton state and clears cached strategies", () => {
    const first = getClientService();
    expect(getClientService()).toBe(first);

    resetClientService();
    expect(getClientService()).not.toBe(first);
    expect(clientMocks.clearStrategyCache).toHaveBeenCalled();
  });
});
