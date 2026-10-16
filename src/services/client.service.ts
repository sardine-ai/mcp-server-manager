/**
 * Client service - manages MCP client detection and sync
 * Facade pattern - delegates all client-specific logic to strategy implementations
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type {
  ClientId,
  Platform,
  DetectedClient,
  ClientStatus,
  ClientMcpConfig,
  OperationResult,
} from "../types/index.js";
import { getConfigService } from "./config.service.js";
import { getProfileService } from "./profile.service.js";
import { getClientStrategy, getRegisteredClientIds, clearStrategyCache } from "./clients/index.js";

/** Client service class */
export class ClientService {
  constructor(private readonly projectDir?: string) {
    if (projectDir) this.projectDir = path.resolve(projectDir);
  }

  private getStrategy(clientId: ClientId) {
    return getClientStrategy(clientId, this.projectDir);
  }

  supportsProjectConfig(clientId: ClientId) {
    return !!this.getStrategy(clientId)?.paths.project;
  }
  /** Get current platform */
  private getPlatform(): Platform {
    return process.platform as Platform;
  }

  /** Get config path for a client on current platform */
  getClientConfigPath(clientId: ClientId): string | null {
    const strategy = this.getStrategy(clientId);
    return strategy?.getPrimaryConfigPath(this.getPlatform()) || null;
  }

  /** Get client display name */
  getClientName(clientId: ClientId): string {
    const strategy = this.getStrategy(clientId);
    return strategy?.metadata.displayName || clientId;
  }

  /** Get all supported client IDs */
  getSupportedClients(): ClientId[] {
    return getRegisteredClientIds();
  }

  /** Check if a client is installed */
  isClientInstalled(clientId: ClientId): boolean {
    const strategy = this.getStrategy(clientId);
    return strategy?.isInstalled(this.getPlatform()) || false;
  }

  /** Read client's current config */
  readClientConfig(clientId: ClientId): ClientMcpConfig | null {
    const strategy = this.getStrategy(clientId);
    return strategy?.readConfig() || null;
  }

  /** Write client's config */
  writeClientConfig(clientId: ClientId, config: ClientMcpConfig): boolean {
    const strategy = this.getStrategy(clientId);
    return strategy?.writeConfig(config) || false;
  }

  /** Detect all installed clients */
  detectClients(profileId?: string): DetectedClient[] {
    const platform = this.getPlatform();
    const clients: DetectedClient[] = [];

    for (const clientId of this.getSupportedClients()) {
      const strategy = this.getStrategy(clientId);
      if (!strategy || (this.projectDir && !strategy.paths.project)) continue;

      const installed = strategy.isInstalled(platform);
      const status = strategy.getStatus(platform, profileId);
      const serverCount = strategy.getServerCount();

      clients.push({
        id: clientId,
        name: strategy.metadata.displayName,
        configPath: strategy.getPrimaryConfigPath(platform),
        mcpConfigPath: strategy.getSecondaryConfigPath(),
        installed,
        hasConfig: strategy.readConfig() !== null,
        status,
        serverCount,
      });
    }

    return clients;
  }

  /** Connect servers to a specific client (add mcpsm gateway to client config) */
  connectClient(clientId: ClientId, profileId?: string): OperationResult {
    const strategy = this.getStrategy(clientId);
    if (!strategy) {
      return { success: false, error: "Unknown client" };
    }

    const configService = getConfigService();
    const port = configService.getPort();

    return strategy.connect(port, profileId);
  }

  /** Disconnect servers from a specific client (remove our servers from client config) */
  disconnectClient(clientId: ClientId, profileId?: string): OperationResult {
    const strategy = this.getStrategy(clientId);
    if (!strategy) {
      return { success: false, error: "Unknown client" };
    }

    return strategy.disconnect(profileId);
  }

  /** Connect all profiles to a client (one gateway entry per profile) */
  connectAllProfiles(clientId: ClientId): {
    succeeded: string[];
    failed: { id: string; error: string }[];
  } {
    const strategy = this.getStrategy(clientId);
    if (!strategy) {
      return { succeeded: [], failed: [{ id: "*", error: "Unknown client" }] };
    }

    const configService = getConfigService();
    const port = configService.getPort();
    const profileService = getProfileService();
    const profiles = profileService.list();

    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const profile of profiles) {
      const result = strategy.connect(port, profile.id);
      if (result.success) {
        succeeded.push(profile.id);
      } else {
        failed.push({ id: profile.id, error: result.error || "Unknown error" });
      }
    }

    return { succeeded, failed };
  }

  /** Disconnect all profiles from a client */
  disconnectAllProfiles(clientId: ClientId): {
    succeeded: string[];
    failed: { id: string; error: string }[];
  } {
    const strategy = this.getStrategy(clientId);
    if (!strategy) {
      return { succeeded: [], failed: [{ id: "*", error: "Unknown client" }] };
    }

    const profileService = getProfileService();
    const profiles = profileService.list();

    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Also disconnect the bare "mcpsm" entry (no profile)
    strategy.disconnect();

    for (const profile of profiles) {
      const result = strategy.disconnect(profile.id);
      if (result.success) {
        succeeded.push(profile.id);
      } else {
        failed.push({ id: profile.id, error: result.error || "Unknown error" });
      }
    }

    return { succeeded, failed };
  }

  /** Get connection status for a client */
  getConnectionStatus(clientId: ClientId, profileId?: string): ClientStatus {
    const strategy = this.getStrategy(clientId);
    if (!strategy) {
      return "not-installed";
    }

    return strategy.getStatus(this.getPlatform(), profileId);
  }

  /** Open client config in editor */
  openClientConfig(clientId: ClientId): OperationResult {
    const configPath = this.getClientConfigPath(clientId);
    if (!configPath) {
      return { success: false, error: "Unknown client" };
    }

    if (!fs.existsSync(configPath)) {
      return { success: false, error: "Config file does not exist" };
    }

    const editor = process.env.EDITOR || process.env.VISUAL || "vi";

    try {
      spawnSync(editor, [configPath], { stdio: "inherit" });
      return { success: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : "Unknown error";
      return { success: false, error };
    }
  }

  /** Check if client exists */
  clientExists(clientId: string): clientId is ClientId {
    return this.getStrategy(clientId as ClientId) !== null;
  }
}

/** Singleton instance */
let instance: ClientService | null = null;

/** Get or create the client service instance */
export function getClientService(): ClientService {
  if (!instance) {
    instance = new ClientService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetClientService(): void {
  instance = null;
  clearStrategyCache();
}

export default ClientService;
