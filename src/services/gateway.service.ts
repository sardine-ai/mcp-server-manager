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
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListToolsResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getConfigService } from "./config.service.js";
import { getAuthService } from "./auth.service.js";
import { getEnvironmentService } from "./environment.service.js";
import { getProfileService } from "./profile.service.js";
import { getAllowedOrigins } from "./settings.service.js";
import { createTransportAuthProvider } from "./oauth-transport.provider.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLogger } from "../shared/logger.js";
import { VERSION } from "../shared/version.js";
import type { LocalServer, RemoteServer } from "../types/index.js";

const logger = createLogger("GatewayService");

/** Header `mcpsm bridge` uses to send the client's project folder (URI-encoded). */
export const PROJECT_DIR_HEADER = "x-mcpsm-project-dir";

/**
 * First candidate that is an existing absolute folder. "/" and the home folder are
 * skipped: GUI clients start servers there when no project is open.
 */
export function resolveProjectDir(candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    const dir = path.resolve(candidate);
    if (dir === path.parse(dir).root || dir === os.homedir()) continue;
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {}
  }
  return undefined;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Why a request may not reach the gateway, or null if it may. Blocks DNS rebinding
 * (Host must be local) and web pages (an Origin must be allowlisted). MCP clients
 * that are not browsers send no Origin.
 */
export function rejectRequestSource(host?: string, origin?: string): string | null {
  let hostname: string | undefined;
  try {
    hostname = host ? new URL(`http://${host}`).hostname : undefined;
  } catch {}
  if (!hostname || !LOCAL_HOSTNAMES.has(hostname)) return `Host not allowed: ${host ?? "(none)"}`;
  if (origin !== undefined && !getAllowedOrigins().includes(origin)) {
    return `Origin not allowed: ${origin}. Allow it with: mcpsm settings set allowedOrigins ${origin}`;
  }
  return null;
}

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

export async function listToolsForGateway(client: Client): Promise<Tool[]> {
  const result = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);
  return result.tools || [];
}

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: Server;
  projectDir?: string;
}

interface ProfileView {
  profileId: string;
  toolToServerMap: Map<string, string>;
  aggregatedTools: Tool[];
}

/** Local servers started in one project folder, shared by that folder's sessions */
interface ProjectEntry {
  sessions: number;
  servers: Map<string, ConnectedServer>; // a new map on each (re)start
  ready: boolean; // every server has started or failed
  whenReady: Promise<void>;
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
  localServers: LocalServer[]; // selected local servers, also started in each open project
  projects: Map<string, ProjectEntry>; // projectDir -> local servers running in it
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
  localServers: [],
  projects: new Map(),
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
async function connectLocalServer(
  server: LocalServer,
  cwd?: string
): Promise<ConnectedServer | null> {
  const configService = getConfigService();
  const envService = getEnvironmentService();

  try {
    logger.info(`Connecting to local server: ${server.name}${cwd ? ` in ${cwd}` : ""}`);

    // Use shell wrapping to ensure PATH resolution
    // This ensures commands like npx, uvx are found even with limited PATH
    const shellCommand = envService.getShellCommand();

    // Prepend the current Node's bin dir inside the command so it takes
    // effect after the login shell finishes sourcing profile scripts.
    // This ensures npx/node resolve to the same version that started mcpsm.
    // The command and its args ride along as positional parameters so the
    // shell never parses them as syntax (spaces, globs and $() stay literal).
    const nodeBinDir = path.dirname(process.execPath);
    const wrappedCommand = 'export PATH="$1:$PATH"; shift; exec "$@"';
    const env: Record<string, string | undefined> = {
      ...process.env,
      ...(server.env || {}),
      ...(cwd && { PWD: cwd }),
    };

    const transport = new StdioClientTransport({
      command: shellCommand, // e.g., "/bin/zsh" or "/bin/bash"
      // -l = login shell (loads full PATH). "mcpsm" is the placeholder for $0.
      args: [
        "-l",
        "-c",
        wrappedCommand,
        "mcpsm",
        nodeBinDir,
        envService.expandHome(server.command, env.HOME),
        ...(server.args ?? []),
      ],
      env: env as Record<string, string>,
      cwd,
    });

    const client = new Client({ name: "mcpsm-gateway", version: VERSION }, { capabilities: {} });

    await client.connect(transport);

    // Get available tools
    const allTools = await listToolsForGateway(client);

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
    const allTools = await listToolsForGateway(client);

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

function closeServers(servers: Map<string, ConnectedServer>): Promise<unknown> {
  return Promise.allSettled([...servers.values()].map(closeServerConnection));
}

/**
 * (Re)starts every selected local server in the project and closes the previous ones.
 * Sessions list the shared tools until then, so they are told when the project's are ready.
 */
// ponytail: all selected local servers start per open project and stop with its last session.
// Sessions dropped without a DELETE keep theirs until the next refresh/stop.
function startProjectServers(projectDir: string, entry: ProjectEntry): Promise<unknown> {
  const previous = entry.servers;
  const servers = new Map<string, ConnectedServer>();
  const isCurrent = (): boolean =>
    gatewayState.projects.get(projectDir) === entry && entry.servers === servers;
  entry.servers = servers;
  entry.ready = false;
  entry.whenReady = Promise.allSettled(
    gatewayState.localServers.map(async (definition) => {
      const server = await connectLocalServer(definition, projectDir);
      if (!server) return;
      if (isCurrent()) servers.set(definition.id, server);
      else await closeServerConnection(server); // project closed or restarted meanwhile
    })
  ).then(() => {
    if (!isCurrent()) return;
    entry.ready = true;
    for (const session of gatewayState.activeSessions.values()) {
      if (session.projectDir !== projectDir) continue;
      session.server.sendToolListChanged().catch((error: unknown) => {
        logger.warn(`Failed to notify session of project tools: ${String(error)}`);
      });
    }
  });
  return closeServers(previous);
}

function acquireProject(projectDir: string): void {
  let entry = gatewayState.projects.get(projectDir);
  if (!entry) {
    entry = { sessions: 0, servers: new Map(), ready: false, whenReady: Promise.resolve() };
    gatewayState.projects.set(projectDir, entry);
    void startProjectServers(projectDir, entry);
  }
  entry.sessions++;
}

function releaseProject(projectDir: string): void {
  const entry = gatewayState.projects.get(projectDir);
  if (!entry || --entry.sessions > 0) return;
  gatewayState.projects.delete(projectDir);
  void closeServers(entry.servers);
}

function closeAllProjectServers(): Promise<unknown> {
  return Promise.allSettled(
    [...gatewayState.projects.values()].map((e) => closeServers(e.servers))
  );
}

/** A project session's servers: the project's local instances plus the shared remote ones */
function buildProjectView(
  profileId: string,
  entry: ProjectEntry
): (ProfileView & { servers: Map<string, ConnectedServer> }) | null {
  const servers = new Map<string, ConnectedServer>();
  for (const id of new Set([...gatewayState.connectedServers.keys(), ...entry.servers.keys()])) {
    const shared = gatewayState.connectedServers.get(id);
    const server = entry.servers.get(id) ?? (shared?.type === "remote" ? shared : undefined);
    if (server) servers.set(id, server);
  }
  const view = buildProfileView(profileId, servers);
  return view && { ...view, servers };
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function prefixTool(serverName: string, tool: Tool): Tool {
  const prefixedTool: Tool = {
    ...tool,
    name: `${serverName}__${tool.name}`,
    description: `[${serverName}] ${tool.description || ""}`,
  };

  // Clients display title over name, so titles need the prefix too
  if (tool.title) {
    prefixedTool.title = `[${serverName}] ${tool.title}`;
  }

  if (tool.annotations?.title) {
    prefixedTool.annotations = {
      ...tool.annotations,
      title: `[${serverName}] ${tool.annotations.title}`,
    };
  }

  return prefixedTool;
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
      const prefixedTool = prefixTool(server.name, tool);

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

function buildProfileView(
  profileId: string,
  servers: Map<string, ConnectedServer> = gatewayState.connectedServers
): ProfileView | null {
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

  for (const [serverId, server] of servers) {
    if (profileServerIds && !profileServerIds.has(serverId)) continue;

    for (const tool of server.tools) {
      const prefixedTool = prefixTool(server.name, tool);
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
  toolToServerMap: Map<string, string> = gatewayState.toolToServerMap,
  servers: Map<string, ConnectedServer> = gatewayState.connectedServers
): Promise<CallToolResult> {
  const serverId = toolToServerMap.get(toolName);

  if (!serverId) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  const server = servers.get(serverId);
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

function createSessionServer(profileId?: string, projectDir?: string): Server {
  const sessionServer = new Server(
    { name: "mcpsm-gateway", version: VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    }
  );

  // Project sessions use their project's servers once all have started
  const projectView = (): ReturnType<typeof buildProjectView> => {
    const entry = projectDir ? gatewayState.projects.get(projectDir) : undefined;
    return entry?.ready ? buildProjectView(profileId ?? "default", entry) : null;
  };

  sessionServer.setRequestHandler(ListToolsRequestSchema, () => {
    const view = projectView();
    if (view) return { tools: view.aggregatedTools };
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
    const sharedId = toolMap.get(toolName);
    const shared = sharedId ? gatewayState.connectedServers.get(sharedId) : undefined;
    // Remote servers are shared, so their calls need not wait for the project's local ones
    if (!projectDir || shared?.type === "remote") {
      return await handleToolCall(toolName, args, toolMap);
    }

    // Local servers read their cwd, so calls run on the project's instances
    const entry = gatewayState.projects.get(projectDir);
    if (entry && !entry.ready) await entry.whenReady;
    const view = projectView();
    if (!view) return toolError(`The servers for ${projectDir} are restarting. Try again.`);
    if (view.toolToServerMap.has(toolName)) {
      return await handleToolCall(toolName, args, view.toolToServerMap, view.servers);
    }

    // Listed from the shared instance before the project's started
    if (!sharedId || !shared) return toolError(`Unknown tool: ${toolName}`);
    if (!view.servers.has(sharedId)) {
      return toolError(`${shared.name} failed to start in ${projectDir}. See: mcpsm daemon logs`);
    }
    return toolError(
      `${toolName} is not available in ${projectDir}: ${shared.name} does not offer it there. Reload the tool list for this project's tools.`
    );
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
    gatewayState.localServers = localServers;
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
      ...localServers.map((s) => connectLocalServer(s)),
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
      const origin = req.headers.origin;
      const rejection = rejectRequestSource(req.headers.host, origin);
      if (rejection) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: rejection }));
        return;
      }

      // CORS only for allowlisted origins
      if (origin) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, mcp-session-id, mcp-protocol-version"
        );
        res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
      }

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
          // Not in Access-Control-Allow-Headers, so web pages cannot set it
          const projectHeader = req.headers[PROJECT_DIR_HEADER];
          let projectDir: string | undefined;
          try {
            if (typeof projectHeader === "string")
              projectDir = resolveProjectDir([decodeURIComponent(projectHeader)]);
          } catch {}
          const sessionServer = createSessionServer(profileId, projectDir);
          const newTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: (): string => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (newSessionId): void => {
              currentSessionId = newSessionId;
              gatewayState.activeSessions.set(newSessionId, {
                transport: newTransport,
                server: sessionServer,
                projectDir,
              });
              if (projectDir) acquireProject(projectDir);
            },
          });

          transport = newTransport;

          // Clean up session when transport closes
          transport.onclose = (): void => {
            if (currentSessionId) {
              if (projectDir) releaseProject(projectDir);
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
    const closePromises: Promise<unknown>[] = [closeAllProjectServers()];
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

    gatewayState = createGatewayState();

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

    // Close existing connections; open projects restart with the new definitions
    gatewayState.localServers = localServers;
    const closePromises = Array.from(gatewayState.connectedServers.values()).map((server) =>
      closeServerConnection(server)
    );
    const projectRestarts = [...gatewayState.projects].map(([dir, entry]) =>
      startProjectServers(dir, entry)
    );
    await Promise.allSettled([...closePromises, ...projectRestarts]);
    gatewayState.connectedServers.clear();
    gatewayState.toolToServerMap.clear();
    gatewayState.aggregatedTools = [];

    // Reconnect to selected servers
    const connectionPromises: Promise<ConnectedServer | null>[] = [
      ...localServers.map((s) => connectLocalServer(s)),
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
    // Project instances too, so a disabled tool disappears from project sessions
    const servers = [
      ...gatewayState.connectedServers.values(),
      ...[...gatewayState.projects.values()].flatMap((entry) => [...entry.servers.values()]),
    ];

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
