/**
 * OpenCode Strategy - Strategy for OpenCode CLI
 * OpenCode keeps servers under 'mcp' (V1) or 'mcp.servers' (V2) in opencode.json(c)
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

type Servers = Record<string, ClientServerConfig>;

/** V2 groups servers under mcp.servers; a V1 server named "servers" has a type */
function isV2Mcp(mcp: unknown): mcp is { servers: Servers } {
  const servers = (mcp as { servers?: unknown } | undefined)?.servers;
  return !!servers && typeof servers === "object" && typeof (servers as Servers).type !== "string";
}

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
    gatewayType: "stdio",
  };

  readonly paths: ClientPlatformPaths = {
    executable: "opencode",
    project: "opencode.json",
    primary: {
      darwin: path.join(this.getHomedir(), ".config", "opencode", "opencode.json"),
      win32: path.join(this.getHomedir(), ".config", "opencode", "opencode.json"),
      linux: path.join(this.getHomedir(), ".config", "opencode", "opencode.json"),
    },
    binaryPaths: {
      darwin: "/usr/local/bin/opencode",
      linux: "/usr/local/bin/opencode",
    },
  };

  getPrimaryConfigPath(_platform: Platform) {
    return this.getWriteConfigPath();
  }

  // === Server Container Access ===

  protected getServersFromConfig(config: ClientMcpConfig): Servers | undefined {
    return isV2Mcp(config.mcp) ? config.mcp.servers : config.mcp;
  }

  /** Keeps the file's shape; new files use the V1 shape, which V2 also accepts */
  protected setServersInConfig(config: ClientMcpConfig, servers: Servers): ClientMcpConfig {
    const mcp = isV2Mcp(config.mcp) ? { ...config.mcp, servers } : servers;
    return { ...config, $schema: OpenCodeStrategy.OPENCODE_SCHEMA_URL, mcp: mcp as Servers };
  }

  /** OpenCode starts local servers in the workspace, which the bridge passes on */
  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const { command, args } = this.buildBridgeConfig(port, profileId);
    return { type: "local", command: [command, ...args] };
  }

  /**
   * Config paths in search order. Global: $XDG_CONFIG_HOME/opencode (or ~/.config/opencode)
   * opencode.json, then opencode.jsonc.
   */
  private getConfigSearchPaths(): string[] {
    const dir =
      this.projectDir ??
      path.join(process.env.XDG_CONFIG_HOME || path.join(this.getHomedir(), ".config"), "opencode");
    return [path.join(dir, "opencode.json"), path.join(dir, "opencode.jsonc")];
  }

  private findExistingConfigPath(): string | null {
    return this.getConfigSearchPaths().find((configPath) => fs.existsSync(configPath)) ?? null;
  }

  /** Existing config file, else opencode.json */
  private getWriteConfigPath(): string {
    return this.findExistingConfigPath() ?? this.getConfigSearchPaths()[0];
  }

  /**
   * Override isInstalled to check all possible config locations
   */
  isInstalled(platform: Platform): boolean {
    if (this.findExistingConfigPath()) return true;
    if (fs.existsSync(path.join(this.getHomedir(), ".opencode.json"))) return true;

    // Check if the opencode config directory exists (indicates opencode is installed)
    const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(this.getHomedir(), ".config");
    const opencodeConfigDir = path.join(xdgConfigHome, "opencode");
    if (fs.existsSync(opencodeConfigDir)) return true;

    return super.isInstalled(platform);
  }

  readConfig(): ClientMcpConfig | null {
    const configPath = this.findExistingConfigPath();
    if (!configPath) return null;

    try {
      return parseJsonWithComments(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      this.log.debug(`Failed to read config from ${configPath}:`, error);
      return null;
    }
  }

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
