import fs from "fs";
import { updateGatewayAddresses } from "./gateway-port.js";
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
    executable: "codex",
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

  updateGatewayPort(port: number) {
    const configPath = this.getEffectiveConfigPath(this.getPlatform());
    if (!configPath || !fs.existsSync(configPath)) return { success: true };
    try {
      const config = TOML.parse(fs.readFileSync(configPath, "utf8"));
      const servers = config.mcp_servers;
      if (
        !servers ||
        typeof servers !== "object" ||
        Array.isArray(servers) ||
        servers instanceof Date
      )
        return { success: true };
      if (updateGatewayAddresses(servers, port))
        fs.writeFileSync(configPath, TOML.stringify(config));
      return { success: true };
    } catch {
      return { success: false, error: "Cannot update client configuration at " + configPath };
    }
  }

  protected tomlToStandardConfig(tomlConfig: TOML.JsonMap): ClientMcpConfig {
    const mcpServers: Record<string, ClientServerConfig> = {};

    const mcpServersToml = tomlConfig.mcp_servers as
      | Record<string, Record<string, unknown>>
      | undefined;

    if (!mcpServersToml) return { mcpServers };
    for (const [name, server] of Object.entries(mcpServersToml)) {
      const serverConfig: ClientServerConfig = {};
      if (server.command) {
        serverConfig.command = server.command as string;
        serverConfig.args = (server.args as string[]) || [];
      }
      if (server.url) serverConfig.url = server.url as string;
      if (server.type) serverConfig.type = server.type as string;
      if (server.env) serverConfig.env = server.env as Record<string, string>;
      mcpServers[name] = serverConfig;
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
          !(existingServer instanceof Date)
            ? { ...existingServer }
            : {};
        delete serverConfig.command;
        delete serverConfig.args;
        delete serverConfig.url;
        delete serverConfig.type;
        delete serverConfig.env;

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
