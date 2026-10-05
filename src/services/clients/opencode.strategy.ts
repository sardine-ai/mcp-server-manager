/**
 * OpenCode Strategy - Strategy for OpenCode CLI
 * OpenCode uses 'mcp' key for servers and has multiple possible config locations
 */

import fs from "fs";
import { parseJsonWithComments } from "../../shared/json.js";
import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { ClientMcpConfig, ClientServerConfig, Platform } from "../../types/index.js";

export class OpenCodeStrategy extends JsonClientStrategy {
  private static readonly OPENCODE_SCHEMA_URL = "https://opencode.ai/config.json";

  readonly metadata: ClientMetadata = {
    id: "opencode",
    displayName: "OpenCode",
    description: "OpenCode AI agent CLI",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: false,
    hasSecondaryConfigPath: false,
    configFormat: "json",
    gatewayType: "url-only",
  };

  readonly paths: ClientPlatformPaths = {
    project: "opencode.json",
    // Primary path is the XDG standard location: $HOME/.config/opencode/config.json
    primary: {
      darwin: path.join(this.getHomedir(), ".config", "opencode", "config.json"),
      win32: path.join(this.getHomedir(), ".config", "opencode", "config.json"),
      linux: path.join(this.getHomedir(), ".config", "opencode", "config.json"),
    },
    binaryPaths: {
      darwin: "/usr/local/bin/opencode",
      linux: "/usr/local/bin/opencode",
    },
  };

  getPrimaryConfigPath(platform: Platform) {
    if (this.projectDir) return this.getWriteConfigPath();
    return super.getPrimaryConfigPath(platform);
  }

  // === Server Container Access (uses 'mcp' not 'mcpServers') ===

  protected getServersFromConfig(
    config: ClientMcpConfig
  ): Record<string, ClientServerConfig> | undefined {
    return config.mcp;
  }

  protected setServersInConfig(
    config: ClientMcpConfig,
    servers: Record<string, ClientServerConfig>
  ): ClientMcpConfig {
    return { ...config, $schema: OpenCodeStrategy.OPENCODE_SCHEMA_URL, mcp: servers };
  }

  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    return {
      type: "remote",
      url: `http://localhost:${port}${mcpPath}`,
    };
  }

  /**
   * Get all possible config paths in search order:
   * 1. $XDG_CONFIG_HOME/opencode/config.json (or $HOME/.config/opencode/config.json)
   * 2. $HOME/.opencode.json (legacy fallback)
   */
  private getConfigSearchPaths(): string[] {
    if (this.projectDir) {
      return [
        path.join(this.projectDir, "opencode.json"),
        path.join(this.projectDir, "opencode.jsonc"),
      ];
    }
    const homedir = this.getHomedir();
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(homedir, ".config");

    return [
      path.join(xdgConfigHome, "opencode", "config.json"),
      path.join(homedir, ".opencode.json"),
    ];
  }

  /**
   * Find the first existing config file path
   */
  private findExistingConfigPath(): string | null {
    for (const configPath of this.getConfigSearchPaths()) {
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    return null;
  }

  /**
   * Get the path to use for writing config
   * Uses existing path if found, otherwise uses XDG standard path
   */
  private getWriteConfigPath(): string {
    const existingPath = this.findExistingConfigPath();
    if (existingPath) {
      return existingPath;
    }
    // Default to XDG standard path ($HOME/.config/opencode/config.json)
    return this.getConfigSearchPaths()[0];
  }

  /**
   * Override isInstalled to check all possible config locations
   */
  isInstalled(platform: Platform): boolean {
    // Check if any config file exists
    if (this.findExistingConfigPath()) return true;

    // Check if the opencode config directory exists (indicates opencode is installed)
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(this.getHomedir(), ".config");
    const opencodeConfigDir = path.join(xdgConfigHome, "opencode");
    if (fs.existsSync(opencodeConfigDir)) return true;

    // Check binary paths
    const binaryPath = this.paths.binaryPaths?.[platform];
    if (binaryPath && fs.existsSync(binaryPath)) return true;

    return false;
  }

  /**
   * Override readConfig to check all possible config locations
   */
  readConfig(): ClientMcpConfig | null {
    const configPath = this.findExistingConfigPath();

    if (!configPath) {
      return null;
    }

    try {
      const data = fs.readFileSync(configPath, "utf8");
      return this.projectDir ? parseJsonWithComments(data) : (JSON.parse(data) as ClientMcpConfig);
    } catch (error) {
      this.log.debug(`Failed to read config from ${configPath}:`, error);
      return null;
    }
  }

  /**
   * Override writeConfig to use appropriate config location
   */
  writeConfig(config: ClientMcpConfig): boolean {
    const configPath = this.getWriteConfigPath();

    try {
      this.ensureDirectory(configPath);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return true;
    } catch (error) {
      this.log.debug(`Failed to write config to ${configPath}:`, error);
      return false;
    }
  }
}
