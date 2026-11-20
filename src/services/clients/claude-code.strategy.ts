/**
 * Claude Code Strategy - Strategy for Claude Code CLI tool
 */

import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";

export class ClaudeCodeStrategy extends JsonClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "claude-code",
    displayName: "Claude Code",
    description: "Anthropic's Claude Code CLI tool",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: false,
    hasSecondaryConfigPath: false,
    configFormat: "json",
    gatewayType: "stdio",
  };

  readonly paths: ClientPlatformPaths = {
    executable: "claude",
    project: ".mcp.json",
    primary: {
      darwin: path.join(this.getHomedir(), ".claude.json"),
      win32: path.join(this.getHomedir(), ".claude.json"),
      linux: path.join(this.getHomedir(), ".claude.json"),
    },
    appBundles: {
      darwin: "/Applications/Claude.app", // Claude Code shares detection with Claude Desktop
    },
  };
}
