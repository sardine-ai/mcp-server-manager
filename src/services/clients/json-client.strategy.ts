/**
 * JSON Client Strategy - Base class for JSON-based client strategies
 * Handles JSON config reading/writing
 * Default uses "mcpServers" key - override getServersFromConfig/setServersInConfig for other keys
 */

import fs from "fs";
import { parseJsonWithComments } from "../../shared/json.js";
import { BaseClientStrategy } from "./base-client.strategy.js";
import type { ClientMcpConfig, ClientServerConfig } from "../../types/index.js";

/**
 * Base class for JSON-based client strategies
 * Handles JSON config reading/writing
 * Default uses "mcpServers" key - subclasses can override for other keys
 */
export abstract class JsonClientStrategy extends BaseClientStrategy {
  // === Server Container Access (default: mcpServers) ===

  protected getServersFromConfig(
    config: ClientMcpConfig
  ): Record<string, ClientServerConfig> | undefined {
    return config.mcpServers;
  }

  protected setServersInConfig(
    config: ClientMcpConfig,
    servers: Record<string, ClientServerConfig>
  ): ClientMcpConfig {
    return { ...config, mcpServers: servers };
  }

  // === Configuration I/O ===

  readConfig(): ClientMcpConfig | null {
    const platform = this.getPlatform();
    const configPath = this.getEffectiveConfigPath(platform);

    if (!configPath || !fs.existsSync(configPath)) {
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

  writeConfig(config: ClientMcpConfig): boolean {
    const platform = this.getPlatform();
    const configPath = this.getEffectiveConfigPath(platform);

    if (!configPath) return false;

    try {
      this.ensureDirectory(configPath);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return true;
    } catch (error) {
      this.log.debug(`Failed to write config to ${configPath}:`, error);
      return false;
    }
  }

  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    return {
      command: "npx",
      args: ["-y", "supergateway", "--streamableHttp", `http://localhost:${port}${mcpPath}`],
    };
  }
}
