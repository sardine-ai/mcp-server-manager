import type { LocalServer, RemoteServer, Result, Server } from "../../types/index.js";
import {
  validateCommand,
  validateServerId,
  validateServerName,
  validateUrl,
} from "../../shared/validators.js";
import { ConfigRepository } from "./config.repository.js";
import { SelectionService } from "./selection.service.js";
import { ToolFilterService } from "./tool-filter.service.js";

export class ServerManager {
  constructor(
    private readonly repository: ConfigRepository,
    private readonly selectionService: SelectionService,
    private readonly toolFilterService: ToolFilterService
  ) {}

  getLocalServers(): LocalServer[] {
    return this.repository.getConfig().servers;
  }

  getRemoteServers(): RemoteServer[] {
    return this.repository.getConfig().remoteServers;
  }

  getAllServers(): Server[] {
    const config = this.repository.getConfig();
    return [...config.servers, ...config.remoteServers];
  }

  findServer(idOrName: string): { server: Server; type: "local" | "remote" } | null {
    const local = this.repository
      .getConfig()
      .servers.find((s) => s.id === idOrName || s.name === idOrName);
    if (local) return { server: local, type: "local" };

    const remote = this.repository
      .getConfig()
      .remoteServers.find((s) => s.id === idOrName || s.name === idOrName);
    if (remote) return { server: remote, type: "remote" };

    return null;
  }

  findLocalServer(id: string): LocalServer | undefined {
    return this.repository.getConfig().servers.find((s) => s.id === id);
  }

  findRemoteServer(id: string): RemoteServer | undefined {
    return this.repository.getConfig().remoteServers.find((s) => s.id === id);
  }

  generateServerId(name: string): string {
    const baseId = name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    let id = baseId;
    let counter = 1;

    while (this.findServer(id)) {
      id = `${baseId}-${counter}`;
      counter++;
    }

    return id;
  }

  addLocalServer(server: LocalServer): Result {
    const idValidation = validateServerId(server.id);
    if (!idValidation.valid) {
      return { success: false, error: idValidation.error };
    }

    const nameValidation = validateServerName(server.name);
    if (!nameValidation.valid) {
      return { success: false, error: nameValidation.error };
    }

    const cmdValidation = validateCommand(server.command);
    if (!cmdValidation.valid) {
      return { success: false, error: cmdValidation.error };
    }

    if (this.findServer(server.id)) {
      return { success: false, error: `Server with ID '${server.id}' already exists` };
    }

    this.repository.updateConfig((config) => {
      config.servers.push(server);
    });

    this.selectionService.ensureLocalSelected(server.id);

    return { success: true };
  }

  addRemoteServer(server: RemoteServer): Result {
    const idValidation = validateServerId(server.id);
    if (!idValidation.valid) {
      return { success: false, error: idValidation.error };
    }

    const nameValidation = validateServerName(server.name);
    if (!nameValidation.valid) {
      return { success: false, error: nameValidation.error };
    }

    const urlValidation = validateUrl(server.url);
    if (!urlValidation.valid) {
      return { success: false, error: urlValidation.error };
    }

    if (this.findServer(server.id)) {
      return { success: false, error: `Server with ID '${server.id}' already exists` };
    }

    this.repository.updateConfig((config) => {
      config.remoteServers.push(server);
    });

    this.selectionService.ensureRemoteSelected(`remote:${server.id}`);

    return { success: true };
  }

  updateLocalServer(id: string, updates: Partial<LocalServer>): Result {
    const index = this.repository.getConfig().servers.findIndex((s) => s.id === id);
    if (index === -1) {
      return { success: false, error: `Local server '${id}' not found` };
    }

    this.repository.updateConfig((config) => {
      config.servers[index] = { ...config.servers[index], ...updates };
    });

    return { success: true };
  }

  updateRemoteServer(id: string, updates: Partial<RemoteServer>): Result {
    const index = this.repository.getConfig().remoteServers.findIndex((s) => s.id === id);
    if (index === -1) {
      return { success: false, error: `Remote server '${id}' not found` };
    }

    this.repository.updateConfig((config) => {
      config.remoteServers[index] = { ...config.remoteServers[index], ...updates };
    });

    return { success: true };
  }

  deleteLocalServer(id: string): Result {
    const index = this.repository.getConfig().servers.findIndex((s) => s.id === id);
    if (index === -1) {
      return { success: false, error: `Local server '${id}' not found` };
    }

    this.repository.updateConfig((config) => {
      config.servers.splice(index, 1);
    });
    this.toolFilterService.removeFilter(id);
    return { success: true };
  }

  deleteRemoteServer(id: string): Result {
    const index = this.repository.getConfig().remoteServers.findIndex((s) => s.id === id);
    if (index === -1) {
      return { success: false, error: `Remote server '${id}' not found` };
    }

    this.repository.updateConfig((config) => {
      config.remoteServers.splice(index, 1);
    });
    this.toolFilterService.removeFilter(`remote:${id}`);
    return { success: true };
  }

  deleteServer(id: string): Result {
    const result = this.findServer(id);
    if (!result) {
      return { success: false, error: `Server '${id}' not found` };
    }

    return result.type === "local" ? this.deleteLocalServer(id) : this.deleteRemoteServer(id);
  }
}
