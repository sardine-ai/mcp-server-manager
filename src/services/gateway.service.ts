/**
 * Gateway Service - MCP multiplexing gateway
 *
 * This service creates an HTTP server that:
 * 1. Accepts MCP connections from clients (Claude, Cursor, etc.)
 * 2. Spawns and manages local MCP servers (STDIO)
 * 3. Connects to remote MCP servers (HTTP/SSE)
 * 4. Routes MCP requests to the appropriate servers
 * 5. Applies tool filtering based on user configuration
 */

import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getConfigService } from "./config.service.js";
import { getAuthService } from "./auth.service.js";
import { getEnvironmentService } from "./environment.service.js";
import { getProfileService } from "./profile.service.js";
import { createTransportAuthProvider } from "./oauth-transport.provider.js";
import path from "node:path";
import { createLogger } from "../shared/logger.js";
import { VERSION } from "../shared/version.js";
import type { LocalServer, RemoteServer } from "../types/index.js";

const logger = createLogger("GatewayService");

type RemoteTransport = SSEClientTransport | StreamableHTTPClientTransport;

interface ConnectedServer {
  id: string;
  name: string;
  type: "local" | "remote";
  client: Client;
  transport: StdioClientTransport | RemoteTransport;
  tools: Tool[];
}

async function closeServerConnection(server: ConnectedServer): Promise<void> {
  try {
    await Promise.race([
      server.transport.close(),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          logger.warn(`Timeout closing connection to ${server.name}`);
          resolve();
        }, 5000);
      }),
    ]);
  } catch (error) {
    logger.warn(`Error closing connection to ${server.name}:`, error);
  }
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

interface ProfileView {
  profileId: string;
  toolToServerMap: Map<string, string>;
  aggregatedTools: Tool[];
}

interface GatewayState {
  running: boolean;
  port: number;
  httpServer: HttpServer | null;
  activeSessions: Map<string, SessionEntry>;
  connectedServers: Map<string, ConnectedServer>;
  toolToServerMap: Map<string, string>; // toolName -> serverId
  aggregatedTools: Tool[];
  profileViews: Map<string, ProfileView>;
  activeSelection: Set<string> | null;
}

const createGatewayState = (): GatewayState => ({
  running: false,
  port: 8850,
  httpServer: null,
  activeSessions: new Map(),
  connectedServers: new Map(),
  toolToServerMap: new Map(),
  aggregatedTools: [],
  profileViews: new Map(),
  activeSelection: null,
});

let gatewayState: GatewayState = createGatewayState();

let refreshLock: Promise<void> = Promise.resolve();

/**
 * Start proactive OAuth token refresh for remote servers.
 * When a token is refreshed, reconnects just that server.
 */
function startProactiveTokenRefresh(remoteServers: RemoteServer[]): void {
  const authService = getAuthService();
  const oauthServers = remoteServers.filter((s) => s.oauth?.enabled);

  if (oauthServers.length === 0) return;

  authService.startProactiveRefresh(oauthServers, (serverId: string) => {
    // On successful refresh, reconnect the specific server
    reconnectServer(serverId).catch((error) => {
      logger.warn(`Failed to reconnect server ${serverId} after token refresh:`, error);
    });
  });
}

/**
 * Reconnect a single server after token refresh.
 * Serialized through refreshLock to avoid concurrent state mutations.
 */
async function reconnectServer(serverId: string): Promise<void> {
  const runReconnect = async (): Promise<void> => {
    if (!gatewayState.running) return;

    const configService = getConfigService();
    // serverId could be "remote:xxx" or just "xxx"
    const rawId = serverId.startsWith("remote:") ? serverId.slice(7) : serverId;
    const remoteServers = configService.getRemoteServers();
    const server = remoteServers.find((s) => s.id === rawId);

    if (!server) {
      logger.debug(`Server ${serverId} not found for reconnection`);
      return;
    }

    const connectedKey = `remote:${server.id}`;
    const existing = gatewayState.connectedServers.get(connectedKey);

    if (existing) {
      logger.info(`Reconnecting ${server.name} after token refresh`);
      await closeServerConnection(existing);
      gatewayState.connectedServers.delete(connectedKey);
    }

    const connected = await connectRemoteServer(server);
    if (connected) {
      gatewayState.connectedServers.set(connected.id, connected);
      refreshAggregatedTools();

      // Notify active sessions about tool list changes
      const notifyPromises = Array.from(gatewayState.activeSessions.values()).map(
        async (session) => {
          try {
            await session.server.sendToolListChanged();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Failed to notify session of tool changes: ${message}`);
          }
        }
      );
      await Promise.allSettled(notifyPromises);

      logger.info(`Reconnected ${server.name} successfully after token refresh`);
    } else {
      logger.warn(`Failed to reconnect ${server.name} after token refresh`);
    }
  };

  refreshLock = refreshLock.then(
    () => runReconnect(),
    () => runReconnect()
  );

  await refreshLock;
}

/**
 * Connect to a local STDIO-based MCP server
 */
async function connectLocalServer(server: LocalServer): Promise<ConnectedServer | null> {
  const configService = getConfigService();
  const envService = getEnvironmentService();

  try {
    logger.info(`Connecting to local server: ${server.name}`);

    // Use shell wrapping to ensure PATH resolution
    // This ensures commands like npx, uvx are found even with limited PATH
    const shellCommand = envService.getShellCommand();
    const fullCommand =
      server.args && server.args.length > 0
        ? `${server.command} ${server.args.join(" ")}`
        : server.command;

    // Prepend the current Node's bin dir inside the command so it takes
    // effect after the login shell finishes sourcing profile scripts.
    // This ensures npx/node resolve to the same version that started mcpsm.
    const nodeBinDir = path.dirname(process.execPath);
    const wrappedCommand = `export PATH="${nodeBinDir}:$PATH" && ${fullCommand}`;

    const transport = new StdioClientTransport({
      command: shellCommand, // e.g., "/bin/zsh" or "/bin/bash"
      args: ["-l", "-c", wrappedCommand], // -l = login shell (loads full PATH)
      env: { ...process.env, ...(server.env || {}) } as Record<string, string>,
    });

    const client = new Client({ name: "mcpsm-gateway", version: VERSION }, { capabilities: {} });

    await client.connect(transport);

    // Get available tools
    const toolsResult = await client.listTools();
    const allTools = toolsResult.tools || [];

    // Apply tool filtering
    const toolFilters = configService.getToolFilters();
    const filter = toolFilters[server.id];
    const disabledTools = new Set(filter?.disabledTools || []);
    const enabledTools = allTools.filter((t) => !disabledTools.has(t.name));

    logger.info(
      `Connected to ${server.name}: ${enabledTools.length}/${allTools.length} tools enabled`
    );

    return {
      id: server.id,
      name: server.name,
      type: "local",
      client,
      transport,
      tools: enabledTools,
    };
  } catch (error) {
    logger.error(`Failed to connect to local server ${server.name}:`, error);
    return null;
  }
}

/**
 * Connect to a remote HTTP/SSE MCP server
 */
async function connectRemoteServer(server: RemoteServer): Promise<ConnectedServer | null> {
  const configService = getConfigService();
  const authService = getAuthService();

  try {
    logger.info(`Connecting to remote server: ${server.name} (${server.type})`);

    const url = new URL(server.url);
    const headers: Record<string, string> = { ...(server.headers || {}) };
    const transportOptions: {
      requestInit?: { headers: Record<string, string> };
      authProvider?: ReturnType<typeof createTransportAuthProvider>;
    } = {};

    // Check for static bearer token first
    if (server.bearerToken) {
      headers["Authorization"] = `Bearer ${server.bearerToken}`;
    } else if (server.oauth?.enabled) {
      // Use SDK auth provider to auto-refresh OAuth tokens
      transportOptions.authProvider = createTransportAuthProvider(server, authService);
      logger.debug(`Using OAuth provider for ${server.name}`);
    }

    if (Object.keys(headers).length > 0) {
      transportOptions.requestInit = { headers };
    }

    // Create appropriate transport based on server type
    let transport: RemoteTransport;

    if (server.type === "sse") {
      transport = new SSEClientTransport(url, transportOptions);
    } else {
      // HTTP type uses StreamableHTTP
      transport = new StreamableHTTPClientTransport(url, transportOptions);
    }

    const client = new Client({ name: "mcpsm-gateway", version: VERSION }, { capabilities: {} });

    await client.connect(transport);

    // Get available tools
    const toolsResult = await client.listTools();
    const allTools = toolsResult.tools || [];

    // Apply tool filtering
    const toolFilters = configService.getToolFilters();
    const filterId = `remote:${server.id}`;
    const filter = toolFilters[filterId];
    const disabledTools = new Set(filter?.disabledTools || []);
    const enabledTools = allTools.filter((t) => !disabledTools.has(t.name));

    logger.info(
      `Connected to ${server.name}: ${enabledTools.length}/${allTools.length} tools enabled`
    );

    return {
      id: filterId,
      name: server.name,
      type: "remote",
      client,
      transport,
      tools: enabledTools,
    };
  } catch (error) {
    logger.error(`Failed to connect to remote server ${server.name}:`, error);
    return null;
  }
}

/**
 * Build the aggregated tool list and tool-to-server mapping
 */
function buildToolMapping(): Tool[] {
  const allTools: Tool[] = [];
  gatewayState.toolToServerMap.clear();

  for (const [serverId, server] of gatewayState.connectedServers) {
    for (const tool of server.tools) {
      // Prefix tool name with server name to avoid conflicts
      const prefixedTool: Tool = {
        ...tool,
        name: `${server.name}__${tool.name}`,
        description: `[${server.name}] ${tool.description || ""}`,
      };

      allTools.push(prefixedTool);
      gatewayState.toolToServerMap.set(prefixedTool.name, serverId);
    }
  }

  return allTools;
}

/** Rebuild aggregated tool list and tool mapping */
function refreshAggregatedTools(): Tool[] {
  const aggregated = buildToolMapping();
  gatewayState.aggregatedTools = aggregated;
  refreshProfileViews();
  return aggregated;
}

function buildProfileView(profileId: string): ProfileView | null {
  const profileService = getProfileService();
  const profile = profileService.getProfile(profileId);

  if (!profile) return null;

  // Build the set of server IDs this profile includes.
  // Empty arrays = include all connected servers (backwards compat).
  // Note: remoteServers may contain string IDs or full server objects (legacy data).
  const localIds = profile.servers.map((s) =>
    typeof s === "string" ? s : (s as { id: string }).id
  );
  const remoteIds = profile.remoteServers.map(
    (s) => `remote:${typeof s === "string" ? s : (s as { id: string }).id}`
  );
  const includesAll = localIds.length === 0 && remoteIds.length === 0;

  const profileServerIds = includesAll
    ? null // null = match everything
    : new Set<string>([...localIds, ...remoteIds]);

  const tools: Tool[] = [];
  const toolMap = new Map<string, string>();

  for (const [serverId, server] of gatewayState.connectedServers) {
    if (profileServerIds && !profileServerIds.has(serverId)) continue;

    for (const tool of server.tools) {
      const prefixedTool: Tool = {
        ...tool,
        name: `${server.name}__${tool.name}`,
        description: `[${server.name}] ${tool.description || ""}`,
      };
      tools.push(prefixedTool);
      toolMap.set(prefixedTool.name, serverId);
    }
  }

  logger.debug(
    `Profile '${profileId}': ${tools.length} tool(s) from ${includesAll ? "all" : (profileServerIds?.size ?? 0)} server(s)`
  );

  return { profileId, toolToServerMap: toolMap, aggregatedTools: tools };
}

function refreshProfileViews(): void {
  const profileService = getProfileService();
  profileService.reload();
  const profiles = profileService.list();

  const newViews = new Map<string, ProfileView>();
  for (const profile of profiles) {
    const view = buildProfileView(profile.id);
    if (view) {
      newViews.set(profile.id, view);
    }
  }

  gatewayState.profileViews = newViews;
  logger.info(`Rebuilt ${newViews.size} profile view(s)`);
}

/**
 * Handle tool call by routing to the appropriate server
 */
async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  toolToServerMap: Map<string, string> = gatewayState.toolToServerMap
): Promise<CallToolResult> {
  const serverId = toolToServerMap.get(toolName);

  if (!serverId) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  const server = gatewayState.connectedServers.get(serverId);
  if (!server) {
    return {
      content: [{ type: "text", text: `Server not connected: ${serverId}` }],
      isError: true,
    };
  }

  // Remove the server prefix from the tool name
  const originalToolName = toolName.replace(`${server.name}__`, "");

  try {
    const result = await server.client.callTool({ name: originalToolName, arguments: args });
    return result as CallToolResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Tool call failed: ${errorMessage}` }],
      isError: true,
    };
  }
}

function createSessionServer(profileId?: string): Server {
  const sessionServer = new Server(
    { name: "mcpsm-gateway", version: VERSION },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  sessionServer.setRequestHandler(ListToolsRequestSchema, () => {
    if (profileId) {
      const view = gatewayState.profileViews.get(profileId);
      return { tools: view?.aggregatedTools ?? [] };
    }
    return { tools: gatewayState.aggregatedTools };
  });

  sessionServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};
    const toolMap = profileId
      ? (gatewayState.profileViews.get(profileId)?.toolToServerMap ?? new Map<string, string>())
      : gatewayState.toolToServerMap;
    return await handleToolCall(toolName, args, toolMap);
  });

  return sessionServer;
}

/**
 * Start the MCP gateway server
 */
export async function startGateway(
  selectedServerIds?: string[]
): Promise<{ success: boolean; error?: string }> {
  if (gatewayState.running) {
    return { success: false, error: "Gateway is already running" };
  }

  const configService = getConfigService();
  const port = configService.getPort();

  logger.info(`Starting MCP Gateway on port ${port}...`);

  try {
    // Get enabled servers
    let localServers = configService.getLocalServers();
    let remoteServers = configService.getRemoteServers();

    // Determine which servers to actually start
    // Priority: explicit selectedServerIds > TUI selection state
    const usingExplicitSelection = !!(selectedServerIds && selectedServerIds.length > 0);
    let serverIdsToStart: Set<string> = new Set();

    if (usingExplicitSelection) {
      // Explicit server IDs provided (from CLI or profile)
      serverIdsToStart = new Set(selectedServerIds);
    } else {
      // Use TUI selection state - respects user's checked/unchecked selections
      const selectionState = configService.getSelectionState();
      serverIdsToStart = new Set([...selectionState.local, ...selectionState.remote]);
    }

    // Also include all servers referenced by any profile so all profile views can be populated
    const profileService = getProfileService();
    for (const profileItem of profileService.list()) {
      const profile = profileService.getProfile(profileItem.id);
      if (!profile) continue;
      for (const s of profile.servers)
        serverIdsToStart.add(typeof s === "string" ? s : (s as { id: string }).id);
      for (const s of profile.remoteServers)
        serverIdsToStart.add(`remote:${typeof s === "string" ? s : (s as { id: string }).id}`);
    }

    // Filter servers to only those in the start set
    const selectedSet = serverIdsToStart;
    gatewayState.activeSelection = usingExplicitSelection ? new Set(selectedSet) : null;
    localServers = localServers.filter((s) => selectedSet.has(s.id));
    remoteServers = remoteServers.filter(
      (s) => selectedSet.has(s.id) || selectedSet.has(`remote:${s.id}`)
    );

    if (localServers.length === 0 && remoteServers.length === 0) {
      logger.info(
        "No enabled servers found; starting gateway with 0 tools (enable servers and refresh to connect)"
      );
    }

    // Connect to all servers
    const connectionPromises: Promise<ConnectedServer | null>[] = [
      ...localServers.map(connectLocalServer),
      ...remoteServers.map(connectRemoteServer),
    ];

    const results = await Promise.all(connectionPromises);
    const connectedServers = results.filter((r): r is ConnectedServer => r !== null);
    const failedCount = results.length - connectedServers.length;

    if (failedCount > 0) {
      logger.warn(`Skipped ${failedCount} server(s) due to connection errors`);
    }

    if (connectedServers.length === 0) {
      logger.warn("No servers connected; starting gateway with 0 tools");
    }

    // Store connected servers
    for (const server of connectedServers) {
      gatewayState.connectedServers.set(server.id, server);
    }

    // Build tool mapping
    const aggregatedTools = refreshAggregatedTools();
    logger.info(
      `Aggregated ${aggregatedTools.length} tools from ${connectedServers.length} servers`
    );

    // Create HTTP server with StreamableHTTP transport
    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, mcp-session-id, mcp-protocol-version"
      );

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Health check endpoint
      if (req.url === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        const profileDetails: Record<string, { tools: number; servers: number }> = {};
        for (const [id, view] of gatewayState.profileViews) {
          profileDetails[id] = {
            tools: view.aggregatedTools.length,
            servers:
              view.toolToServerMap.size > 0 ? new Set(view.toolToServerMap.values()).size : 0,
          };
        }
        res.end(
          JSON.stringify({
            status: "ok",
            servers: gatewayState.connectedServers.size,
            tools: gatewayState.aggregatedTools.length,
            profiles: profileDetails,
          })
        );
        return;
      }

      // MCP endpoint - handle all MCP requests
      // Matches /mcp (global) and /mcp/{profileId} (profile-specific)
      const parsedUrl = new URL(req.url || "/", `http://localhost:${gatewayState.port}`);
      const mcpMatch = parsedUrl.pathname.match(/^\/mcp(?:\/([a-zA-Z0-9_-]+))?$/);

      if (mcpMatch) {
        const profileId = mcpMatch[1] || "default";

        // Validate profile exists when specified
        if (profileId && !gatewayState.profileViews.has(profileId)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Profile not found: ${profileId}` }));
          return;
        }

        // Check for existing session
        const sessionId = req.headers["mcp-session-id"] as string | undefined;
        let transport = sessionId
          ? gatewayState.activeSessions.get(sessionId)?.transport
          : undefined;

        if (!transport) {
          // Create new transport AND server for new sessions
          let currentSessionId: string | undefined;
          const sessionServer = createSessionServer(profileId);
          const newTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: (): string => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (newSessionId): void => {
              currentSessionId = newSessionId;
              gatewayState.activeSessions.set(newSessionId, {
                transport: newTransport,
                server: sessionServer,
              });
            },
          });

          transport = newTransport;

          // Clean up session when transport closes
          transport.onclose = (): void => {
            if (currentSessionId) {
              gatewayState.activeSessions.delete(currentSessionId);
              sessionServer.close().catch((err) => {
                logger.warn(`Error closing session server ${currentSessionId}:`, err);
              });
              logger.debug(`Session ${currentSessionId} closed and cleaned up`);
            }
          };

          await sessionServer.connect(transport);
        }

        await transport.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        httpServer.off("error", onError);
        reject(err);
      };

      httpServer.once("error", onError);
      httpServer.listen(port, "127.0.0.1", () => {
        httpServer.off("error", onError);
        logger.info(`Gateway listening on http://localhost:${port}`);
        resolve();
      });
    });

    gatewayState = {
      ...gatewayState,
      running: true,
      port,
      httpServer,
    };

    // Start proactive OAuth token refresh for remote servers
    startProactiveTokenRefresh(remoteServers);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start gateway: ${errorMessage}`);
    await stopGateway();
    return { success: false, error: errorMessage };
  }
}

/**
 * Stop the MCP gateway server
 */
export async function stopGateway(): Promise<{ success: boolean; error?: string }> {
  logger.info("Stopping gateway...");

  // Stop proactive token refresh
  getAuthService().stopProactiveRefresh();

  try {
    // Close all server connections with timeout to prevent hanging
    const closePromises: Promise<void>[] = [];
    for (const [, server] of gatewayState.connectedServers) {
      closePromises.push(closeServerConnection(server));
    }

    // Wait for all connections to close (with timeout)
    await Promise.allSettled(closePromises);

    // Close all active MCP sessions (servers + transports)
    const sessionClosePromises = Array.from(gatewayState.activeSessions.values()).map(
      async (session) => {
        try {
          await session.server.close();
        } catch (err) {
          logger.warn("Error closing session server:", err);
        }
        try {
          await session.transport.close();
        } catch (err) {
          logger.warn("Error closing session transport:", err);
        }
      }
    );
    await Promise.allSettled(sessionClosePromises);

    // Close HTTP server
    if (gatewayState.httpServer) {
      const httpServer = gatewayState.httpServer;
      await new Promise<void>((resolve) => {
        httpServer.close((): void => resolve());
      });
    }

    gatewayState = {
      running: false,
      port: 8850,
      httpServer: null,
      activeSessions: new Map(),
      connectedServers: new Map(),
      toolToServerMap: new Map(),
      aggregatedTools: [],
      profileViews: new Map(),
      activeSelection: null,
    };

    logger.info("Gateway stopped");
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error stopping gateway: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Get gateway status
 */
export function getGatewayStatus(): {
  running: boolean;
  port: number;
  serverCount: number;
  toolCount: number;
} {
  return {
    running: gatewayState.running,
    port: gatewayState.port,
    serverCount: gatewayState.connectedServers.size,
    toolCount: gatewayState.aggregatedTools.length,
  };
}

/**
 * Refresh the running gateway configuration without restarting the process
 */
export async function refreshGateway(
  reason = "manual"
): Promise<{ success: boolean; error?: string }> {
  if (!gatewayState.running || !gatewayState.httpServer) {
    return { success: false, error: "Gateway is not running" };
  }

  const runRefresh = async (): Promise<void> => {
    logger.info(`Refreshing gateway configuration (${reason})...`);

    const configService = getConfigService();
    const authService = getAuthService();

    // Reload data from disk
    configService.reload();
    authService.reload();
    getProfileService().reload();

    const configuredPort = configService.getPort();
    if (configuredPort !== gatewayState.port && gatewayState.httpServer) {
      logger.info(`Port changed (${gatewayState.port} -> ${configuredPort}), re-binding server`);
      await new Promise<void>((resolve, reject) => {
        gatewayState.httpServer?.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      await new Promise<void>((resolve, reject) => {
        const server = gatewayState.httpServer;
        if (!server) {
          resolve();
          return;
        }

        const onError = (err: Error): void => {
          server.off("error", onError);
          reject(err);
        };

        server.once("error", onError);
        server.listen(configuredPort, "127.0.0.1", () => {
          server.off("error", onError);
          resolve();
        });
      });

      gatewayState.port = configuredPort;
    }

    // Determine selected servers (same logic as startGateway)
    const selectionState = configService.getSelectionState();
    const serverIdsToStart =
      gatewayState.activeSelection && gatewayState.activeSelection.size > 0
        ? new Set(gatewayState.activeSelection)
        : new Set([...selectionState.local, ...selectionState.remote]);

    // Also include all servers referenced by any profile
    const profileService = getProfileService();
    for (const profileItem of profileService.list()) {
      const profile = profileService.getProfile(profileItem.id);
      if (!profile) continue;
      for (const s of profile.servers)
        serverIdsToStart.add(typeof s === "string" ? s : (s as { id: string }).id);
      for (const s of profile.remoteServers)
        serverIdsToStart.add(`remote:${typeof s === "string" ? s : (s as { id: string }).id}`);
    }

    const localServers = configService.getLocalServers().filter((s) => serverIdsToStart.has(s.id));
    const remoteServers = configService
      .getRemoteServers()
      .filter((s) => serverIdsToStart.has(`remote:${s.id}`));

    if (localServers.length === 0 && remoteServers.length === 0) {
      logger.warn("No servers selected/enabled during refresh; clearing connections");
    }

    // Close existing connections
    const closePromises = Array.from(gatewayState.connectedServers.values()).map((server) =>
      closeServerConnection(server)
    );
    await Promise.allSettled(closePromises);
    gatewayState.connectedServers.clear();
    gatewayState.toolToServerMap.clear();
    gatewayState.aggregatedTools = [];

    // Reconnect to selected servers
    const connectionPromises: Promise<ConnectedServer | null>[] = [
      ...localServers.map(connectLocalServer),
      ...remoteServers.map(connectRemoteServer),
    ];

    const results = await Promise.all(connectionPromises);
    const connectedServers = results.filter((r): r is ConnectedServer => r !== null);
    const failedCount = results.length - connectedServers.length;

    if (failedCount > 0) {
      logger.warn(`Skipped ${failedCount} server(s) during refresh due to connection errors`);
    }

    for (const server of connectedServers) {
      gatewayState.connectedServers.set(server.id, server);
    }

    const aggregatedTools = refreshAggregatedTools();

    // Restart proactive token refresh with updated server list
    startProactiveTokenRefresh(remoteServers);

    // Notify ALL active session servers about tool list changes
    const notifyPromises = Array.from(gatewayState.activeSessions.values()).map(async (session) => {
      try {
        await session.server.sendToolListChanged();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to notify session of tool changes: ${message}`);
      }
    });
    await Promise.allSettled(notifyPromises);

    logger.info(
      `Gateway refresh complete: ${connectedServers.length} server(s), ${aggregatedTools.length} tool(s)`
    );
  };

  refreshLock = refreshLock.then(
    () => runRefresh(),
    () => runRefresh()
  );

  try {
    await refreshLock;
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Gateway refresh failed: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Refresh tool filters without reconnecting servers.
 */
export async function refreshGatewayTools(
  reason = "manual"
): Promise<{ success: boolean; error?: string }> {
  if (!gatewayState.running) {
    return { success: false, error: "Gateway is not running" };
  }

  const runRefresh = async (): Promise<void> => {
    logger.info(`Refreshing gateway tools (${reason})...`);

    const configService = getConfigService();
    configService.reload();
    getProfileService().reload();

    const toolFilters = configService.getToolFilters();
    const servers = Array.from(gatewayState.connectedServers.values());

    const refreshResults = await Promise.all(
      servers.map(async (server) => {
        try {
          const toolsResult = await server.client.listTools();
          const allTools = toolsResult.tools || [];
          const disabledTools = new Set(toolFilters[server.id]?.disabledTools || []);
          server.tools = allTools.filter((tool) => !disabledTools.has(tool.name));
          return { id: server.id, success: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn(`Failed to refresh tools for ${server.name}: ${message}`);
          return { id: server.id, success: false };
        }
      })
    );

    const failedCount = refreshResults.filter((result) => !result.success).length;
    if (failedCount > 0) {
      logger.warn(`Tool refresh skipped ${failedCount} server(s) due to errors`);
    }

    const aggregatedTools = refreshAggregatedTools();

    // Notify ALL active session servers about tool list changes
    const notifyPromises = Array.from(gatewayState.activeSessions.values()).map(async (session) => {
      try {
        await session.server.sendToolListChanged();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to notify session of tool changes: ${message}`);
      }
    });
    await Promise.allSettled(notifyPromises);

    logger.info(`Gateway tool refresh complete: ${aggregatedTools.length} tool(s)`);
  };

  refreshLock = refreshLock.then(
    () => runRefresh(),
    () => runRefresh()
  );

  try {
    await refreshLock;
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Gateway tool refresh failed: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Run gateway in foreground mode (blocking)
 */
export async function runGatewayForeground(selectedServerIds?: string[]): Promise<void> {
  const result = await startGateway(selectedServerIds);

  if (!result.success) {
    console.error(`Failed to start gateway: ${result.error}`);
    process.exit(1);
  }

  console.log(`Gateway running on http://localhost:${gatewayState.port}`);
  console.log(`Connected to ${gatewayState.connectedServers.size} servers`);
  console.log(`Serving ${gatewayState.aggregatedTools.length} tools`);
  console.log("Press Ctrl+C to stop");

  // Handle shutdown signals
  const shutdown = async (): Promise<void> => {
    console.log("\nShutting down...");
    await stopGateway();
    process.exit(0);
  };

  // Handle uncaught errors to ensure cleanup
  const handleError = async (error: Error): Promise<void> => {
    console.error("Uncaught error:", error);
    await shutdown();
  };

  const handleRefreshSignal = (): void => {
    refreshGateway("signal")
      .then((result) => {
        if (!result.success) {
          logger.warn(`Gateway refresh from signal failed: ${result.error}`);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Gateway refresh from signal crashed: ${message}`);
      });
  };

  const handleToolRefreshSignal = (): void => {
    refreshGatewayTools("signal")
      .then((result) => {
        if (!result.success) {
          logger.warn(`Gateway tool refresh from signal failed: ${result.error}`);
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Gateway tool refresh from signal crashed: ${message}`);
      });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", handleRefreshSignal);
  process.on("SIGUSR1", handleToolRefreshSignal);
  process.on("uncaughtException", handleError);
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    handleError(error);
  });

  // Keep process alive
  await new Promise(() => {});
}

// Test helpers (no runtime impact in production)
export function resetGatewayStateForTests(): void {
  gatewayState = createGatewayState();
}

export function setGatewayStateForTests(state: Partial<GatewayState>): void {
  gatewayState = { ...gatewayState, ...state };
}
