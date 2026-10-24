import { createMcpConnection, closeMcpConnection } from "./mcp-connection.js";
/**
 * Testing service - tests MCP servers and discovers tools
 */

import type {
  LocalServer,
  RemoteServer,
  Server,
  ServerTestResult,
  ServerToolFilter,
  ServerAuthRequirements,
  ToolAnnotations,
  ToolData,
} from "../types/index.js";
import { getConfigService } from "./config.service.js";
import { getAuthService } from "./auth.service.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("TestingService");

/** Extended test result with auth info */
export interface ExtendedServerTestResult extends ServerTestResult {
  requiresAuth?: boolean;
  authInProgress?: boolean;
  authRequirements?: ServerAuthRequirements;
}

/** OAuth auth callback type */
export type AuthCallback = (
  server: RemoteServer,
  authUrl: string,
  onComplete: () => Promise<void>
) => Promise<boolean>;

/** Testing service class */
export class TestingService {
  private readonly testTimeout = 8000; // 8 seconds timeout per server
  private authCallback: AuthCallback | null = null;
  private pendingAuthServers: Set<string> = new Set();

  /** Count tokens for a tool (simplified) */
  private countToolTokens(tool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }): number {
    const text = JSON.stringify(tool);
    // Rough estimation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /** Update tool filter with results */
  private updateToolFilter(
    filterId: string,
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      annotations?: ToolAnnotations;
    }>,
    error?: string
  ): void {
    const configService = getConfigService();
    let filter = configService.getServerToolFilter(filterId);

    if (!filter) {
      filter = { allTools: [], toolsData: {} };
    }

    if (error) {
      configService.setServerToolFilter(filterId, {
        ...filter,
        error,
      } as ServerToolFilter & { error: string });
      return;
    }

    const toolNames = tools.map((t) => t.name);
    const toolsData: Record<string, ToolData> = {};
    let totalTokens = 0;

    for (const tool of tools) {
      const tokens = this.countToolTokens(tool);
      toolsData[tool.name] = {
        tokens,
        description: tool.description,
        annotations: tool.annotations,
      };
      totalTokens += tokens;
    }

    // Preserve disabled tools, keeping only those that still exist on the server
    const preservedDisabledTools = (filter.disabledTools || []).filter((t) =>
      toolNames.includes(t)
    );

    configService.setServerToolFilter(filterId, {
      allTools: toolNames,
      disabledTools: preservedDisabledTools,
      toolsData,
      totalTokens,
    });
  }

  /** Test a local STDIO server */
  async testLocalServer(server: LocalServer): Promise<ServerTestResult> {
    return this.testConnection(server);
  }

  private async testConnection(
    server: LocalServer | RemoteServer,
    skipAuth = false
  ): Promise<ExtendedServerTestResult> {
    const remote = "url" in server;
    const filterId = remote ? "remote:" + server.id : server.id;
    const controller = new AbortController();
    const abortCleanups: Array<() => void> = [];
    let unauthorized: globalThis.Response | undefined;
    let connection: ReturnType<typeof createMcpConnection> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        controller.abort();
        reject(new Error("Timeout"));
      }, this.testTimeout);
    });
    try {
      const operation = async (): Promise<ServerTestResult> => {
        const headers = remote ? await this.getAuthHeaders(server) : undefined;
        if (controller.signal.aborted) throw new Error("Timeout");
        connection = createMcpConnection(server, "test", {
          headers,
          fetch: async (input, init) => {
            const requestController = new AbortController();
            const abort = (): void => requestController.abort();
            for (const signal of [controller.signal, init?.signal]) {
              if (!signal) continue;
              if (signal.aborted) abort();
              else {
                signal.addEventListener("abort", abort, { once: true });
                abortCleanups.push(() => signal.removeEventListener("abort", abort));
              }
            }
            const response = await fetch(input, {
              ...init,
              signal: requestController.signal,
            });
            if (response.status === 401) unauthorized = response;
            return response;
          },
        });
        await connection.client.connect(connection.transport);
        const result = await connection.client.listTools(undefined, { signal: controller.signal });
        if (controller.signal.aborted) throw new Error("Timeout");
        this.updateToolFilter(filterId, result.tools);
        return { success: true, toolCount: result.tools.length };
      };
      return await Promise.race([operation(), timeout]);
    } catch (error) {
      const message = controller.signal.aborted
        ? "Timeout"
        : error instanceof Error
          ? error.message
          : String(error);
      if (remote && (unauthorized || message.includes("401") || message.includes("Unauthorized"))) {
        const requirements = unauthorized?.headers.get("WWW-Authenticate");
        const authRequirements = requirements
          ? getAuthService().parseWWWAuthenticate(requirements)
          : undefined;
        const result: ExtendedServerTestResult = (!skipAuth && unauthorized
          ? await this.handleUnauthorized(server, unauthorized)
          : null) ?? {
          success: false,
          error: "HTTP 401 - Authentication required",
          toolCount: 0,
          requiresAuth: true,
          authRequirements,
        };
        this.updateToolFilter(filterId, [], result.error);
        return result;
      }
      this.updateToolFilter(filterId, [], message);
      return { success: false, error: message, toolCount: 0 };
    } finally {
      clearTimeout(deadline);
      controller.abort();
      if (connection)
        await closeMcpConnection(connection).catch((error) =>
          log.debug("Connection cleanup failed:", error)
        );
      for (const cleanup of abortCleanups) cleanup();
    }
  }

  /** Set callback for handling OAuth authentication */
  setAuthCallback(callback: AuthCallback | null): void {
    this.authCallback = callback;
  }

  /** Check if server has auth in progress */
  hasAuthInProgress(serverId: string): boolean {
    return this.pendingAuthServers.has(serverId);
  }

  /** Get authorization headers for a server */
  private async getAuthHeaders(server: RemoteServer): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(server.headers || {}),
    };

    // Static bearer token takes precedence
    if (server.bearerToken) {
      headers["Authorization"] = `Bearer ${server.bearerToken}`;
      return headers;
    }

    // Check for OAuth token
    if (server.oauth?.enabled) {
      const authService = getAuthService();
      const token = await authService.getValidToken(server);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /** Handle 401 response and potentially trigger OAuth */
  private async handleUnauthorized(
    server: RemoteServer,
    response: globalThis.Response,
    autoEnableOAuth: boolean = false
  ): Promise<ExtendedServerTestResult | null> {
    const wwwAuth = response.headers.get("WWW-Authenticate");
    const authService = getAuthService();
    let authReqs: ServerAuthRequirements | undefined;

    if (wwwAuth) {
      authReqs = authService.parseWWWAuthenticate(wwwAuth);
    }

    // Detect if server requires OAuth
    const serverRequiresOAuth =
      authReqs?.resourceMetadataUrl || (wwwAuth && wwwAuth.toLowerCase().includes("bearer"));

    // If OAuth is not enabled but server requires it, auto-enable if requested
    if (!server.oauth?.enabled && !server.bearerToken && serverRequiresOAuth) {
      if (autoEnableOAuth) {
        // Auto-enable OAuth on the server configuration
        const configService = getConfigService();
        configService.updateRemoteServer(server.id, {
          oauth: { ...server.oauth, enabled: true },
        });
        // Update the server object in memory
        server.oauth = { ...server.oauth, enabled: true };
        log.debug(`Auto-enabled OAuth for server: ${server.id}`);
      } else {
        // Return that auth is required but not configured
        return {
          success: false,
          error: "Authentication required",
          toolCount: 0,
          requiresAuth: true,
          authRequirements: authReqs,
        };
      }
    }

    // If OAuth is enabled, try to start the auth flow
    if (server.oauth?.enabled && this.authCallback) {
      // Start OAuth flow
      const authFlow = await authService.startOAuthFlow(server, authReqs);
      if (authFlow) {
        this.pendingAuthServers.add(server.id);

        // Notify the caller that auth is needed
        const onComplete = async (): Promise<void> => {
          this.pendingAuthServers.delete(server.id);
        };

        const handled = await this.authCallback(server, authFlow.authUrl, onComplete);

        if (handled) {
          return {
            success: false,
            error: "Authentication in progress",
            toolCount: 0,
            requiresAuth: true,
            authInProgress: true,
            authRequirements: authReqs,
          };
        }
      }
    }

    return null;
  }

  /** Test and automatically authenticate a remote server */
  async testAndAuthenticate(
    server: RemoteServer,
    onAuthUrl: (url: string) => Promise<void>,
    options: {
      onPhase?: (phase: "testing" | "authorization-required" | "waiting" | "retesting") => void;
      signal?: globalThis.AbortSignal;
    } = {}
  ): Promise<ExtendedServerTestResult> {
    const auth = getAuthService();
    let state: string | undefined;
    const cancel = (): void => {
      if (state) auth.releaseOAuthFlow(state);
    };
    try {
      options.onPhase?.("testing");
      const result = await this.testRemoteServer(server, true);
      if (options.signal?.aborted) throw new Error("Authorization cancelled");
      if (result.success || !result.requiresAuth) return result;
      options.onPhase?.("authorization-required");
      if (!server.oauth?.enabled) {
        const oauth = { ...server.oauth, enabled: true };
        const updated = getConfigService().updateRemoteServer(server.id, { oauth });
        if (!updated.success) throw new Error(updated.error || "Cannot enable OAuth");
        server = { ...server, oauth };
      }
      const flow = await auth.startOAuthFlow(server, result.authRequirements);
      if (!flow)
        throw new Error("Failed to start OAuth flow - server may not support OAuth discovery");
      state = flow.state;
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) throw new Error("Authorization cancelled");
      await onAuthUrl(flow.authUrl);
      options.onPhase?.("waiting");
      const authResult = await auth.waitForAuth(flow.state);
      if (!authResult.success) throw new Error("Authentication failed: " + authResult.error);
      if (options.signal?.aborted) throw new Error("Authorization cancelled");
      options.onPhase?.("retesting");
      return await this.testRemoteServer(server);
    } catch (error) {
      return {
        success: false,
        toolCount: 0,
        requiresAuth: true,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      options.signal?.removeEventListener("abort", cancel);
      if (state) auth.releaseOAuthFlow(state);
    }
  }

  /** Test a remote HTTP/SSE server */
  async testRemoteServer(
    server: RemoteServer,
    skipAuth: boolean = false
  ): Promise<ExtendedServerTestResult> {
    return this.testConnection(server, skipAuth);
  }

  /** Test a remote server with OAuth retry */
  async testRemoteServerWithAuth(server: RemoteServer): Promise<ExtendedServerTestResult> {
    // First attempt
    let result = await this.testRemoteServer(server);

    // If auth is in progress, wait for it
    if (result.authInProgress) {
      const authService = getAuthService();

      // Wait for any pending auth
      const pendingState = authService.getPendingAuthState(server.id);
      if (pendingState) {
        await authService.waitForAuth(pendingState);
      }

      // Retry the test
      result = await this.testRemoteServer(server);
    }

    return result;
  }

  /** Test any server */
  async testServer(server: Server, type: "local" | "remote"): Promise<ExtendedServerTestResult> {
    if (type === "local") {
      return this.testLocalServer(server as LocalServer);
    }
    return this.testRemoteServer(server as RemoteServer);
  }

  /** Get servers without discovered tools */
  getServersWithoutTools(): {
    local: LocalServer[];
    remote: RemoteServer[];
  } {
    const configService = getConfigService();
    const toolFilters = configService.getToolFilters();

    const local = configService.getLocalServers().filter((server) => {
      const filter = toolFilters[server.id];
      return !filter || !filter.allTools || filter.allTools.length === 0;
    });

    const remote = configService.getRemoteServers().filter((server) => {
      const filter = toolFilters[`remote:${server.id}`];
      return !filter || !filter.allTools || filter.allTools.length === 0;
    });

    return { local, remote };
  }

  /** Get servers that require OAuth */
  getServersRequiringAuth(): RemoteServer[] {
    const configService = getConfigService();
    return configService.getRemoteServers().filter((server) => server.oauth?.enabled);
  }

  /** Test all servers */
  async testAllServers(): Promise<
    Array<{ server: Server; type: "local" | "remote"; result: ExtendedServerTestResult }>
  > {
    const configService = getConfigService();

    const localPromises = configService.getLocalServers().map(async (server) => ({
      server: server as Server,
      type: "local" as const,
      result: await this.testLocalServer(server),
    }));

    const remotePromises = configService.getRemoteServers().map(async (server) => ({
      server: server as Server,
      type: "remote" as const,
      result: await this.testRemoteServer(server),
    }));

    return Promise.all([...localPromises, ...remotePromises]);
  }

  /** Test all servers with streaming results */
  async testAllServersStreaming(
    onResult: (result: {
      server: Server;
      type: "local" | "remote";
      result: ExtendedServerTestResult;
      index: number;
      total: number;
    }) => void
  ): Promise<
    Array<{ server: Server; type: "local" | "remote"; result: ExtendedServerTestResult }>
  > {
    const configService = getConfigService();
    const localServers = configService.getLocalServers();
    const remoteServers = configService.getRemoteServers();
    const total = localServers.length + remoteServers.length;
    const results: Array<{
      server: Server;
      type: "local" | "remote";
      result: ExtendedServerTestResult;
    }> = [];

    let index = 0;

    // Test servers in parallel but stream results as they complete
    const allPromises: Promise<void>[] = [];

    for (const server of localServers) {
      const currentIndex = index++;
      allPromises.push(
        this.testLocalServer(server).then((result) => {
          const entry = { server: server as Server, type: "local" as const, result };
          results.push(entry);
          onResult({ ...entry, index: currentIndex, total });
        })
      );
    }

    for (const server of remoteServers) {
      const currentIndex = index++;
      allPromises.push(
        this.testRemoteServer(server).then((result) => {
          const entry = { server: server as Server, type: "remote" as const, result };
          results.push(entry);
          onResult({ ...entry, index: currentIndex, total });
        })
      );
    }

    await Promise.all(allPromises);
    return results;
  }

  /** Test all servers with OAuth support */
  async testAllServersWithAuth(
    onAuthRequired?: (server: RemoteServer, authUrl: string) => Promise<void>
  ): Promise<
    Array<{ server: Server; type: "local" | "remote"; result: ExtendedServerTestResult }>
  > {
    const configService = getConfigService();
    const results: Array<{
      server: Server;
      type: "local" | "remote";
      result: ExtendedServerTestResult;
    }> = [];

    // Test local servers (no auth needed)
    const localPromises = configService.getLocalServers().map(async (server) => ({
      server: server as Server,
      type: "local" as const,
      result: await this.testLocalServer(server),
    }));
    results.push(...(await Promise.all(localPromises)));

    // Test remote servers with potential OAuth handling
    for (const server of configService.getRemoteServers()) {
      let result = await this.testRemoteServer(server);

      // If authentication required and we have a handler
      if (result.requiresAuth && result.authInProgress && onAuthRequired) {
        const authService = getAuthService();

        // Find the pending auth state for this server
        const pendingState = authService.getPendingAuthState(server.id);
        if (pendingState) {
          // Notify the caller
          const flow = await authService.startOAuthFlow(server, result.authRequirements);
          if (flow) {
            await onAuthRequired(server, flow.authUrl);

            // Wait for auth to complete
            const authResult = await authService.waitForAuth(flow.state);

            if (authResult.success) {
              // Retry the test
              result = await this.testRemoteServer(server);
            }
          }
        }
      }

      results.push({
        server: server as Server,
        type: "remote" as const,
        result,
      });
    }

    return results;
  }

  /** Auto-test servers without tools */
  async autoTestUnknownServers(): Promise<void> {
    const { local, remote } = this.getServersWithoutTools();

    if (local.length === 0 && remote.length === 0) {
      return;
    }

    const localPromises = local.map((server) => this.testLocalServer(server));
    const remotePromises = remote.map((server) => this.testRemoteServer(server));

    await Promise.all([...localPromises, ...remotePromises]);
  }

  /** Check and authenticate servers that require OAuth */
  async checkAndAuthenticateServers(
    onAuthRequired: (server: RemoteServer, authUrl: string) => Promise<void>,
    onProgress?: (message: string) => void
  ): Promise<{ authenticated: string[]; failed: string[]; skipped: string[] }> {
    const configService = getConfigService();
    const authService = getAuthService();

    const authenticated: string[] = [];
    const failed: string[] = [];
    const skipped: string[] = [];

    // Get servers that require OAuth
    const oauthServers = configService.getRemoteServers().filter((s) => s.oauth?.enabled);

    for (const server of oauthServers) {
      onProgress?.(`Checking ${server.name}...`);

      // Check if we already have a valid token
      if (authService.hasValidToken(server.id)) {
        onProgress?.(`${server.name} already authenticated`);
        skipped.push(server.id);
        continue;
      }

      // Try to connect and see if auth is needed
      const result = await this.testRemoteServer(server, true);

      if (result.success) {
        // Server doesn't require auth
        skipped.push(server.id);
        continue;
      }

      if (!result.requiresAuth) {
        // Server failed for another reason
        failed.push(server.id);
        continue;
      }

      // Start OAuth flow
      onProgress?.(`${server.name} requires authentication...`);
      const flow = await authService.startOAuthFlow(server, result.authRequirements);

      if (!flow) {
        onProgress?.(`Failed to start OAuth for ${server.name}`);
        failed.push(server.id);
        continue;
      }

      // Notify caller and open browser
      await onAuthRequired(server, flow.authUrl);

      // Wait for auth to complete
      onProgress?.(`Waiting for ${server.name} authentication...`);
      const authResult = await authService.waitForAuth(flow.state);

      if (authResult.success) {
        onProgress?.(`${server.name} authenticated successfully`);
        authenticated.push(server.id);

        // Re-test the server to verify and get tools
        await this.testRemoteServer(server);
      } else {
        onProgress?.(`${server.name} authentication failed: ${authResult.error}`);
        failed.push(server.id);
      }
    }

    return { authenticated, failed, skipped };
  }
}

/** Singleton instance */
let instance: TestingService | null = null;

/** Get or create the testing service instance */
export function getTestingService(): TestingService {
  if (!instance) {
    instance = new TestingService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetTestingService(): void {
  instance = null;
}

export default TestingService;
