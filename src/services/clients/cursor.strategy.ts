/**
 * Cursor Strategy - Strategy for Cursor IDE
 * Supports real-time config reloading via secondary config path
 */

import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { ClientServerConfig } from "../../types/index.js";

export class CursorStrategy extends JsonClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "cursor",
    displayName: "Cursor",
    description: "AI-powered code editor",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: true,
    hasSecondaryConfigPath: true,
    configFormat: "json",
    gatewayType: "url-only",
  };

  readonly paths: ClientPlatformPaths = {
    project: ".cursor/mcp.json",
    primary: {
      darwin: path.join(
        this.getHomedir(),
        "Library/Application Support/Cursor/User/globalStorage/cursor.mcp/config.json"
      ),
      win32: path.join(this.getAppData(), "Cursor/User/globalStorage/cursor.mcp/config.json"),
      linux: path.join(
        this.getHomedir(),
        ".config/Cursor/User/globalStorage/cursor.mcp/config.json"
      ),
    },
    secondary: path.join(this.getHomedir(), ".cursor/mcp.json"),
    appBundles: {
      darwin: "/Applications/Cursor.app",
    },
  };

  // Cursor supports direct URL connections without supergateway.
  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    return {
      url: `http://localhost:${port}${mcpPath}`,
    };
  }
}
