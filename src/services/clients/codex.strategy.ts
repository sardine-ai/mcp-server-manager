/**
 * Codex CLI Strategy - Strategy for OpenAI's Codex CLI
 * Uses TOML config format and URL-only gateway (no supergateway)
 */

import path from "path";
import TOML from "@iarna/toml";
import { TomlClientStrategy } from "./toml-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";
import type { ClientMcpConfig, ClientServerConfig } from "../../types/index.js";

export class CodexStrategy extends TomlClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "codex",
    displayName: "Codex CLI",
    description: "OpenAI's Codex command-line interface",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: false,
    hasSecondaryConfigPath: false,
    configFormat: "toml",
    gatewayType: "url-only",
  };

  readonly paths: ClientPlatformPaths = {
    project: ".codex/config.toml",
    primary: {
      darwin: path.join(this.getHomedir(), ".codex/config.toml"),
      win32: path.join(this.getHomedir(), ".codex/config.toml"),
      linux: path.join(this.getHomedir(), ".codex/config.toml"),
    },
    binaryPaths: {
      darwin: "/usr/local/bin/codex",
      linux: "/usr/local/bin/codex",
    },
  };

  // Override: Codex uses URL-only gateway (no supergateway)
  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig {
    const mcpPath = profileId ? `/mcp/${profileId}` : "/mcp";
    return {
      url: `http://localhost:${port}${mcpPath}`,
    };
  }

  protected tomlToStandardConfig(tomlConfig: TOML.JsonMap): ClientMcpConfig {
    const mcpServers: Record<string, ClientServerConfig> = {};

    const mcpServersToml = tomlConfig.mcp_servers as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (mcpServersToml) {
      for (const [name, server] of Object.entries(mcpServersToml)) {
        if (server.command || server.url || this.projectDir) {
          const serverConfig: ClientServerConfig = {};

          if (server.command) {
            serverConfig.command = server.command as string;
            serverConfig.args = (server.args as string[]) || [];
          }

          if (server.url) {
            serverConfig.url = server.url as string;
          }

          if (server.type) {
            serverConfig.type = server.type as string;
          }

          if (server.env) {
            serverConfig.env = server.env as Record<string, string>;
          }

          mcpServers[name] = serverConfig;
        }
      }
    }

    return { mcpServers };
  }

  protected standardToTomlConfig(
    config: ClientMcpConfig,
    existingConfig: TOML.JsonMap
  ): TOML.JsonMap {
    const mcpServers: TOML.JsonMap = {};

    if (config.mcpServers) {
      for (const [name, server] of Object.entries(config.mcpServers)) {
        const existingServers = existingConfig.mcp_servers;
        const existingServer =
          this.projectDir &&
          existingServers &&
          typeof existingServers === "object" &&
          !Array.isArray(existingServers) &&
          !(existingServers instanceof Date)
            ? existingServers[name]
            : undefined;
        const serverConfig: TOML.JsonMap =
          existingServer &&
          typeof existingServer === "object" &&
          !Array.isArray(existingServer) &&
          !(existingServer instanceof Date) &&
          existingServer.command === server.command &&
          existingServer.url === server.url
            ? { ...existingServer }
            : {};

        if (server.command) {
          serverConfig.command = server.command;
          if (server.args && server.args.length > 0) {
            serverConfig.args = server.args;
          }
        }

        if (server.url) {
          serverConfig.url = server.url;
        }

        if (server.type) {
          serverConfig.type = server.type;
        }

        if (server.env) {
          serverConfig.env = server.env;
        }

        if (Object.keys(serverConfig).length > 0) {
          mcpServers[name] = serverConfig;
        }
      }
    }

    return {
      ...existingConfig,
      mcp_servers: mcpServers,
    };
  }
}
