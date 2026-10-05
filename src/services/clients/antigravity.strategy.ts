/**
 * Antigravity Strategy - Strategy for Google Antigravity
 * Google Antigravity is a tool that uses MCP (Model Context Protocol) servers
 */

import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { ClientServerConfig } from "../../types/index.js";

export class AntigravityStrategy extends JsonClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "antigravity",
    displayName: "Google Antigravity",
    description: "Google's AI-powered development tool",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: false,
    hasSecondaryConfigPath: false,
    configFormat: "json",
    gatewayType: "url-only",
  };

  readonly paths: ClientPlatformPaths = {
    project: ".agents/mcp_config.json",
    primary: {
      darwin: path.join(this.getHomedir(), ".antigravity/mcp_config.json"),
      win32: path.join(this.getHomedir(), ".antigravity/mcp_config.json"),
      linux: path.join(this.getHomedir(), ".antigravity/mcp_config.json"),
    },
    appBundles: {
      darwin: "/Applications/Antigravity.app",
    },
  };

  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    if (this.projectDir) return super.buildGatewayConfig(port, profileId);
    return {
      url: `http://localhost:${port}${mcpPath}`,
    };
  }
}
