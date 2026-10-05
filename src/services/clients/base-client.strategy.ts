/**
 * Base Client Strategy - Abstract base class for all client strategies
 * Provides common functionality and enforces the strategy contract
 */

import fs from "fs";
import path from "path";
import os from "os";
import type {
  IClientStrategy,
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type {
  Platform,
  ClientMcpConfig,
  ClientServerConfig,
  OperationResult,
  ClientStatus,
} from "../../types/index.js";
import { createLogger } from "../../shared/logger.js";

/**
 * Abstract base class for all client strategies
 * Provides common functionality and enforces the strategy contract
 */
export abstract class BaseClientStrategy implements IClientStrategy {
  protected readonly log;

  abstract readonly metadata: ClientMetadata;
  abstract readonly capabilities: ClientCapabilities;
  abstract readonly paths: ClientPlatformPaths;

  constructor(protected readonly projectDir?: string) {
    this.log = createLogger(this.constructor.name);
  }

  // === Platform Helpers ===

  protected getPlatform(): Platform {
    return process.platform as Platform;
  }

  protected getHomedir(): string {
    return os.homedir();
  }

  protected getAppData(): string {
    return process.env.APPDATA || "";
  }

  // === Path Resolution ===

  getPrimaryConfigPath(platform: Platform): string | null {
    if (this.projectDir) {
      return this.paths.project ? path.join(this.projectDir, this.paths.project) : null;
    }
    return this.paths.primary[platform] || null;
  }

  getSecondaryConfigPath(): string | null {
    if (this.projectDir) return null;
    return this.paths.secondary || null;
  }

  getEffectiveConfigPath(platform: Platform): string | null {
    if (this.projectDir) return this.getPrimaryConfigPath(platform);
    // Real-time clients use secondary path as source of truth
    if (this.capabilities.hasSecondaryConfigPath && this.paths.secondary) {
      return this.paths.secondary;
    }
    return this.paths.primary[platform] || null;
  }

  // === Installation Detection ===

  isInstalled(platform: Platform): boolean {
    const configPath = this.paths.primary[platform];
    if (!configPath) return false;

    const projectPath = this.projectDir ? this.getPrimaryConfigPath(platform) : null;
    if (projectPath && fs.existsSync(projectPath)) return true;

    // Check if config file exists
    if (fs.existsSync(configPath)) return true;

    // Check if parent directory exists
    const parentDir = path.dirname(configPath);
    if (fs.existsSync(parentDir)) return true;

    // Check app bundles (macOS)
    if (platform === "darwin" && this.paths.appBundles?.darwin) {
      if (fs.existsSync(this.paths.appBundles.darwin)) return true;
    }

    // Check binary paths (CLI tools)
    const binaryPath = this.paths.binaryPaths?.[platform];
    if (binaryPath && fs.existsSync(binaryPath)) return true;

    return false;
  }

  // === Configuration I/O (Abstract - must be implemented by subclasses) ===

  abstract readConfig(): ClientMcpConfig | null;
  abstract writeConfig(config: ClientMcpConfig): boolean;

  // === Server Container Access (Abstract - each strategy is self-aware) ===

  /**
   * Get the servers container from config (each strategy knows its own key)
   */
  protected abstract getServersFromConfig(
    config: ClientMcpConfig
  ): Record<string, ClientServerConfig> | undefined;

  /**
   * Create a new config with the servers container set (each strategy knows its own key)
   */
  protected abstract setServersInConfig(
    config: ClientMcpConfig,
    servers: Record<string, ClientServerConfig>
  ): ClientMcpConfig;

  // === Gateway Management ===

  abstract buildGatewayConfig(port: number, profileId?: string): ClientServerConfig;

  protected getGatewayKey(profileId?: string): string {
    return profileId ? `mcpsm-${profileId}` : "mcpsm";
  }

  hasGateway(config: ClientMcpConfig | null, profileId?: string): boolean {
    if (!config) return false;

    const servers = this.getServersFromConfig(config);
    const key = this.getGatewayKey(profileId);
    const gateway = servers?.[key];

    if (!gateway) return false;

    return !!(
      gateway.command ||
      gateway.url ||
      gateway.type ||
      (gateway.args && gateway.args.length > 0) ||
      (gateway.env && Object.keys(gateway.env).length > 0)
    );
  }

  addGateway(config: ClientMcpConfig, port: number, profileId?: string): ClientMcpConfig {
    const servers = this.getServersFromConfig(config) || {};
    const gatewayConfig = this.buildGatewayConfig(port, profileId);
    const key = this.getGatewayKey(profileId);
    return this.setServersInConfig(config, { ...servers, [key]: gatewayConfig });
  }

  removeGateway(config: ClientMcpConfig, profileId?: string): ClientMcpConfig {
    const servers = this.getServersFromConfig(config);
    const key = this.getGatewayKey(profileId);
    if (!servers?.[key]) return config;

    const { [key]: _, ...rest } = servers;
    return this.setServersInConfig(config, rest);
  }

  // === High-Level Operations ===

  connect(port: number, profileId?: string): OperationResult {
    const platform = this.getPlatform();

    if (this.projectDir && !this.paths.project) {
      return { success: false, error: "Client does not support project configuration" };
    }

    if (!this.isInstalled(platform)) {
      return { success: false, error: "Client not installed" };
    }

    try {
      const existingConfig = this.readConfig();
      const configPath = this.getEffectiveConfigPath(platform);
      if (this.projectDir && configPath && fs.existsSync(configPath) && !existingConfig) {
        return { success: false, error: "Could not read project config; file was not changed" };
      }
      let config = existingConfig || {};
      config = this.addGateway(config, port, profileId);

      const success = this.writeConfig(config);
      return {
        success,
        error: success ? undefined : "Failed to write config",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: `Failed to connect: ${errorMsg}` };
    }
  }

  disconnect(profileId?: string): OperationResult {
    if (this.projectDir && !this.paths.project) {
      return { success: false, error: "Client does not support project configuration" };
    }
    try {
      const config = this.readConfig();
      const configPath = this.getEffectiveConfigPath(this.getPlatform());
      if (this.projectDir && configPath && fs.existsSync(configPath) && !config) {
        return { success: false, error: "Could not read project config; file was not changed" };
      }

      if (!config || !this.hasGateway(config, profileId)) {
        return { success: true }; // Already disconnected
      }

      const updatedConfig = this.removeGateway(config, profileId);
      const success = this.writeConfig(updatedConfig);

      return {
        success,
        error: success ? undefined : "Failed to write config",
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: `Failed to disconnect: ${errorMsg}` };
    }
  }

  getStatus(platform: Platform, profileId?: string): ClientStatus {
    if (!this.isInstalled(platform)) {
      return "not-installed";
    }

    const config = this.readConfig();
    return this.hasGateway(config, profileId) ? "connected" : "disconnected";
  }

  getServerCount(): number {
    const config = this.readConfig();
    if (!config) return 0;

    const servers = this.getServersFromConfig(config);
    return servers ? Object.keys(servers).length : 0;
  }

  // === Helper Methods ===

  protected ensureDirectory(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
