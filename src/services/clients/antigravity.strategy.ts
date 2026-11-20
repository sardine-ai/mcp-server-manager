/**
 * Antigravity Strategy - Strategy for Google Antigravity
 * Google Antigravity is a tool that uses MCP (Model Context Protocol) servers
 */

import fs from "fs";
import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { Platform } from "../../types/index.js";

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
    gatewayType: "stdio",
  };

  readonly paths: ClientPlatformPaths = {
    executable: "antigravity",
    project: ".agents/mcp_config.json",
    primary: {
      darwin: path.join(this.getHomedir(), ".gemini/config/mcp_config.json"),
      win32: path.join(this.getHomedir(), ".gemini/config/mcp_config.json"),
      linux: path.join(this.getHomedir(), ".gemini/config/mcp_config.json"),
    },
    appBundles: {
      darwin: "/Applications/Antigravity.app",
    },
  };

  /** Current builds read ~/.gemini/config, older ones ~/.gemini/antigravity */
  getPrimaryConfigPath(platform: Platform): string | null {
    if (this.projectDir) return super.getPrimaryConfigPath(platform);
    const candidates = ["config", "antigravity"].map((dir) =>
      path.join(this.getHomedir(), ".gemini", dir, "mcp_config.json")
    );
    return (
      candidates.find((file) => fs.existsSync(file)) ??
      candidates.find((file) => fs.existsSync(path.dirname(file))) ??
      candidates[0]
    );
  }

  /** A config file at the older location also counts as installed */
  isInstalled(platform: Platform): boolean {
    const configPath = this.getPrimaryConfigPath(platform);
    return (!!configPath && fs.existsSync(configPath)) || super.isInstalled(platform);
  }
}
