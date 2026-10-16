/**
 * VS Code Strategy - Strategy for Visual Studio Code with Continue extension
 * Uses 'servers' key instead of 'mcpServers'
 * Supports real-time config reloading
 */

import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { ClientServerConfig, ClientMcpConfig } from "../../types/index.js";

export class VSCodeStrategy extends JsonClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "vscode",
    displayName: "VS Code (Continue)",
    description: "Visual Studio Code with Continue extension",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: true,
    hasSecondaryConfigPath: false, // VS Code uses primary path for real-time loading
    configFormat: "json",
    gatewayType: "stdio",
  };

  readonly paths: ClientPlatformPaths = {
    project: ".vscode/mcp.json",
    primary: {
      darwin: path.join(this.getHomedir(), "Library/Application Support/Code/User/mcp.json"),
      win32: path.join(this.getAppData(), "Code/User/mcp.json"),
      linux: path.join(this.getHomedir(), ".config/Code/User/mcp.json"),
    },
    appBundles: {
      darwin: "/Applications/Visual Studio Code.app",
    },
  };

  // === Server Container Access (uses 'servers' not 'mcpServers') ===

  protected getServersFromConfig(
    config: ClientMcpConfig
  ): Record<string, ClientServerConfig> | undefined {
    return config.servers;
  }

  protected setServersInConfig(
    config: ClientMcpConfig,
    servers: Record<string, ClientServerConfig>
  ): ClientMcpConfig {
    return { ...config, servers };
  }

  // Override to include 'type' field required by VS Code
  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    return {
      type: "stdio",
      command: "npx",
      args: ["-y", "supergateway", "--streamableHttp", `http://localhost:${port}${mcpPath}`],
    };
  }
}
