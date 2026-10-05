import { describe, expect, it, vi } from "vitest";
import { GatewayConfigService } from "../src/services/config/gateway-config.service.js";
import { ServerManager } from "../src/services/config/server.manager.js";
import type { ConfigRepository } from "../src/services/config/config.repository.js";
import type { AppConfig, LocalServer, RemoteServer } from "../src/types/index.js";

class FakeConfigRepository {
  constructor(
    private config: AppConfig = {
      servers: [],
      remoteServers: [],
      port: 8850,
    }
  ) {}

  getConfig(): AppConfig {
    return this.config;
  }

  updateConfig(update: (config: AppConfig) => void): void {
    update(this.config);
  }
}

function localServer(overrides: Partial<LocalServer> = {}): LocalServer {
  return {
    id: "local",
    name: "Local",
    command: "node",
    args: [],
    ...overrides,
  };
}

function remoteServer(overrides: Partial<RemoteServer> = {}): RemoteServer {
  return {
    id: "remote",
    name: "Remote",
    type: "http",
    url: "https://api.test/mcp",
    ...overrides,
  };
}

function createManager(config?: AppConfig): {
  manager: ServerManager;
  repository: FakeConfigRepository;
  selectionService: {
    ensureLocalSelected: ReturnType<typeof vi.fn>;
    ensureRemoteSelected: ReturnType<typeof vi.fn>;
  };
  toolFilterService: { removeFilter: ReturnType<typeof vi.fn> };
} {
  const repository = new FakeConfigRepository(config);
  const selectionService = {
    ensureLocalSelected: vi.fn(),
    ensureRemoteSelected: vi.fn(),
  };
  const toolFilterService = {
    removeFilter: vi.fn(),
  };
  return {
    repository,
    selectionService,
    toolFilterService,
    manager: new ServerManager(
      repository as unknown as ConfigRepository,
      selectionService as never,
      toolFilterService as never
    ),
  };
}

describe("config manager services", () => {
  it("lists and finds local and remote servers by id or name", () => {
    const config = {
      servers: [localServer()],
      remoteServers: [remoteServer()],
      port: 8850,
    };
    const { manager } = createManager(config);

    expect(manager.getLocalServers()).toEqual([localServer()]);
    expect(manager.getRemoteServers()).toEqual([remoteServer()]);
    expect(manager.getAllServers()).toEqual([localServer(), remoteServer()]);
    expect(manager.findServer("local")).toMatchObject({ type: "local" });
    expect(manager.findServer("Remote")).toMatchObject({ type: "remote" });
    expect(manager.findServer("missing")).toBeNull();
    expect(manager.findLocalServer("local")).toEqual(localServer());
    expect(manager.findRemoteServer("remote")).toEqual(remoteServer());
  });

  it("generates unique ids and validates additions", () => {
    const { manager, selectionService } = createManager({
      servers: [localServer({ id: "docs", name: "Docs" })],
      remoteServers: [],
      port: 8850,
    });

    expect(manager.generateServerId(" Docs!!! ")).toBe("docs-1");
    expect(manager.addLocalServer(localServer({ id: "", name: "Bad" })).success).toBe(false);
    expect(manager.addLocalServer(localServer({ id: "docs", name: "Duplicate" }))).toEqual({
      success: false,
      error: "Server with ID 'docs' already exists",
    });

    expect(manager.addLocalServer(localServer({ id: "new", name: "New" }))).toEqual({
      success: true,
    });
    expect(selectionService.ensureLocalSelected).toHaveBeenCalledWith("new");

    expect(manager.addRemoteServer(remoteServer({ id: "bad", url: "not-a-url" })).success).toBe(
      false
    );
    expect(manager.addRemoteServer(remoteServer({ id: "remote", name: "Remote" }))).toEqual({
      success: true,
    });
    expect(selectionService.ensureRemoteSelected).toHaveBeenCalledWith("remote:remote");
  });

  it("updates and deletes servers with filter cleanup", () => {
    const { manager, repository, toolFilterService } = createManager({
      servers: [localServer()],
      remoteServers: [remoteServer()],
      port: 8850,
    });

    expect(manager.updateLocalServer("missing", { name: "Nope" })).toMatchObject({
      success: false,
    });
    expect(manager.updateRemoteServer("missing", { name: "Nope" })).toMatchObject({
      success: false,
    });

    expect(manager.updateLocalServer("local", { name: "Local Updated" })).toEqual({
      success: true,
    });
    expect(manager.updateRemoteServer("remote", { name: "Remote Updated" })).toEqual({
      success: true,
    });
    expect(repository.getConfig().servers[0].name).toBe("Local Updated");
    expect(repository.getConfig().remoteServers[0].name).toBe("Remote Updated");

    expect(manager.deleteServer("missing")).toMatchObject({ success: false });
    expect(manager.deleteServer("local")).toEqual({ success: true });
    expect(manager.deleteServer("remote")).toEqual({ success: true });
    expect(toolFilterService.removeFilter).toHaveBeenCalledWith("local");
    expect(toolFilterService.removeFilter).toHaveBeenCalledWith("remote:remote");
    expect(manager.deleteLocalServer("missing")).toMatchObject({ success: false });
    expect(manager.deleteRemoteServer("missing")).toMatchObject({ success: false });
  });

  it("reads and validates gateway ports", () => {
    const repository = new FakeConfigRepository({ servers: [], remoteServers: [], port: 8850 });
    const service = new GatewayConfigService(repository as unknown as ConfigRepository);

    expect(service.getPort()).toBe(8850);
    expect(service.setPort(0).success).toBe(false);
    expect(service.setPort(70000).success).toBe(false);
    expect(service.setPort(9000)).toEqual({ success: true });
    expect(repository.getConfig().port).toBe(9000);
  });
});
