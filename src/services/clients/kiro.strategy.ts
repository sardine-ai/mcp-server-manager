/**
 * Kiro Strategy - Strategy for Kiro IDE
 */

import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { ClientServerConfig } from "../../types/index.js";

export class KiroStrategy extends JsonClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "kiro",
    displayName: "Kiro",
    description: "Kiro IDE",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: true,
    hasSecondaryConfigPath: false,
    configFormat: "json",
    gatewayType: "url-only",
  };

  readonly paths: ClientPlatformPaths = {
    project: ".kiro/settings/mcp.json",
    primary: {
      darwin: path.join(this.getHomedir(), ".kiro/settings/mcp.json"),
      win32: path.join(this.getHomedir(), ".kiro/settings/mcp.json"),
      linux: path.join(this.getHomedir(), ".kiro/settings/mcp.json"),
    },
    appBundles: {
      darwin: "/Applications/Kiro.app",
    },
  };

  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    return {
      url: `http://localhost:${port}${mcpPath}`,
    };
  }
}
