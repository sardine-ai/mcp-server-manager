/**
 * Testing service - tests MCP servers and discovers tools
 */

import { spawn, ChildProcess } from "child_process";
import { TextDecoder } from "util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type {
  LocalServer,
  RemoteServer,
  Server,
  ServerTestResult,
  ServerToolFilter,
  ServerAuthRequirements,
} from "../types/index.js";
import { getConfigService } from "./config.service.js";
import { getAuthService } from "./auth.service.js";
import { getEnvironmentService } from "./environment.service.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("TestingService");

/** MCP request structure */
interface McpRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** MCP tools response */
interface McpToolsResponse {
  result?: {
    tools?: Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }>;
  };
}

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

  /** Create initialize request */
  private createInitRequest(): McpRequest {
    return {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-tester", version: "1.0.0" },
      },
    };
  }

  /** Create tools list request */
  private createToolsListRequest(): McpRequest {
    return {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    };
  }

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
    }>,
    error?: string
  ): void {
    const configService = getConfigService();
    let filter = configService.getServerToolFilter(filterId);

    if (!filter) {
      filter = { enabled: [], allTools: [], toolsData: {} };
    }

    if (error) {
      configService.setServerToolFilter(filterId, {
        ...filter,
        error,
      } as ServerToolFilter & { error: string });
      return;
    }

    const toolNames = tools.map((t) => t.name);
    const toolsData: Record<string, { tokens: number; description?: string }> = {};
    let totalTokens = 0;

    for (const tool of tools) {
      const tokens = this.countToolTokens(tool);
      toolsData[tool.name] = {
        tokens,
        description: tool.description,
      };
      totalTokens += tokens;
    }

    // Preserve disabled tools, keeping only those that still exist on the server
    const preservedDisabledTools = (filter.disabledTools || []).filter((t) =>
      toolNames.includes(t)
    );

    configService.setServerToolFilter(filterId, {
      allTools: toolNames,
      enabled: !filter.enabled || filter.enabled.length === 0 ? [...toolNames] : filter.enabled,
      disabledTools: preservedDisabledTools,
      toolsData,
      totalTokens,
    });
  }

  /** Test a local STDIO server */
  async testLocalServer(server: LocalServer): Promise<ServerTestResult> {
    return new Promise((resolve) => {
      const filterId = server.id;
      let proc: ChildProcess;
      let stdout = "";
      let resolved = false;

      const cleanup = (): void => {
        if (!resolved) {
          resolved = true;
          try {
            proc?.kill();
          } catch (error) {
            log.debug("Failed to kill process:", error);
          }
        }
      };

      const timeout = setTimeout(() => {
        cleanup();
        this.updateToolFilter(filterId, [], "Timeout");
        resolve({ success: false, error: "Timeout", toolCount: 0 });
      }, this.testTimeout);

      try {
        // Get environment service to detect shell
        const envService = getEnvironmentService();
        const shellCommand = envService.getShellCommand();

        // If we have zsh available and the command is a shell script or uses shell features,
        // run it through zsh for better compatibility
        if (
          envService.shouldUseZsh() &&
          (server.command.includes("/") || server.command === "sh" || server.command === "bash")
        ) {
          // Run command through zsh
          const fullCommand = server.args
            ? `${server.command} ${server.args.join(" ")}`
            : server.command;
          proc = spawn(shellCommand, ["-c", fullCommand], {
            env: { ...process.env, ...(server.env || {}) },
            stdio: ["pipe", "pipe", "pipe"],
          });
        } else {
          // Use direct spawn as before
          proc = spawn(server.command, server.args, {
            env: { ...process.env, ...(server.env || {}) },
            stdio: ["pipe", "pipe", "pipe"],
          });
        }
      } catch (err) {
        clearTimeout(timeout);
        const error = err instanceof Error ? err.message : "Spawn error";
        this.updateToolFilter(filterId, [], error);
        resolve({ success: false, error, toolCount: 0 });
        return;
      }

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();

        const lines = stdout.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as McpToolsResponse;
            if (msg.result?.tools) {
              clearTimeout(timeout);
              cleanup();

              const tools = msg.result.tools;
              this.updateToolFilter(filterId, tools);

              resolve({
                success: true,
                toolCount: tools.length,
              });
              return;
            }
          } catch (error) {
            log.debug("Failed to parse MCP response:", error);
          }
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        cleanup();
        this.updateToolFilter(filterId, [], err.message);
        resolve({ success: false, error: err.message, toolCount: 0 });
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          const error = `Exited with code ${code}`;
          this.updateToolFilter(filterId, [], error);
          resolve({ success: false, error, toolCount: 0 });
        }
      });

      // Send MCP requests
      setTimeout(() => {
        try {
          proc.stdin?.write(JSON.stringify(this.createInitRequest()) + "\n");

          setTimeout(() => {
            proc.stdin?.write(JSON.stringify(this.createToolsListRequest()) + "\n");
          }, 500);
        } catch (error) {
          log.debug("Failed to write to process stdin:", error);
        }
      }, 300);
    });
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
          oauth: { enabled: true },
        });
        // Update the server object in memory
        server.oauth = { enabled: true };
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
    onAuthUrl: (url: string) => Promise<void>
  ): Promise<ExtendedServerTestResult> {
    const authService = getAuthService();

    // First, test without auth to see if it's needed
    let result = await this.testRemoteServer(server, true);

    // If successful, no auth needed
    if (result.success) {
      return result;
    }

    // If auth required, auto-enable OAuth and authenticate
    if (result.requiresAuth) {
      // Auto-enable OAuth if not already enabled
      if (!server.oauth?.enabled) {
        const configService = getConfigService();
        configService.updateRemoteServer(server.id, {
          oauth: { enabled: true },
        });
        server.oauth = { enabled: true };
      }

      // Start OAuth flow
      const flow = await authService.startOAuthFlow(server, result.authRequirements);
      if (flow) {
        // Notify caller with auth URL
        await onAuthUrl(flow.authUrl);

        // Wait for auth to complete
        const authResult = await authService.waitForAuth(flow.state);

        // Stop callback server
        authService.stopCallbackServer();

        if (authResult.success) {
          // Re-test with the new token
          result = await this.testRemoteServer(server);
        } else {
          return {
            success: false,
            error: `Authentication failed: ${authResult.error}`,
            toolCount: 0,
            requiresAuth: true,
          };
        }
      } else {
        return {
          success: false,
          error: "Failed to start OAuth flow - server may not support OAuth discovery",
          toolCount: 0,
          requiresAuth: true,
        };
      }
    }

    return result;
  }

  /** Test a remote HTTP/SSE server */
  async testRemoteServer(
    server: RemoteServer,
    skipAuth: boolean = false
  ): Promise<ExtendedServerTestResult> {
    const filterId = `remote:${server.id}`;

    // For SSE servers, use the MCP SDK transport directly
    if (server.type === "sse") {
      return this.testRemoteServerWithSDK(server, skipAuth);
    }

    // For HTTP servers, use direct fetch (faster for simple cases)
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.testTimeout);

      const headers = await this.getAuthHeaders(server);
      const messageUrl = server.url;

      // Initialize
      const initResponse = await fetch(messageUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(this.createInitRequest()),
        signal: controller.signal,
      });

      // Handle 401 Unauthorized
      if (initResponse.status === 401) {
        clearTimeout(timeout);

        // If skipAuth is true, just return that auth is required without trying OAuth flow
        if (skipAuth) {
          const error = "HTTP 401 - Authentication required";
          this.updateToolFilter(filterId, [], error);
          return { success: false, error, toolCount: 0, requiresAuth: true };
        }

        const authResult = await this.handleUnauthorized(server, initResponse);
        if (authResult) {
          this.updateToolFilter(filterId, [], authResult.error);
          return authResult;
        }

        const error = "HTTP 401 - Authentication required";
        this.updateToolFilter(filterId, [], error);
        return { success: false, error, toolCount: 0, requiresAuth: true };
      }

      if (!initResponse.ok) {
        clearTimeout(timeout);
        const error = `HTTP ${initResponse.status}`;
        this.updateToolFilter(filterId, [], error);
        return { success: false, error, toolCount: 0 };
      }

      // Capture session ID if provided (for servers like deepwiki)
      const sessionId = initResponse.headers.get("mcp-session-id");
      const toolsHeaders = { ...headers };
      if (sessionId) {
        toolsHeaders["mcp-session-id"] = sessionId;
      }

      // Get tools
      const toolsResponse = await fetch(messageUrl, {
        method: "POST",
        headers: toolsHeaders,
        body: JSON.stringify(this.createToolsListRequest()),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Handle 401 on tools request
      if (toolsResponse.status === 401) {
        // If skipAuth is true, just return that auth is required without trying OAuth flow
        if (skipAuth) {
          const error = "HTTP 401 - Authentication required";
          this.updateToolFilter(filterId, [], error);
          return { success: false, error, toolCount: 0, requiresAuth: true };
        }

        const authResult = await this.handleUnauthorized(server, toolsResponse);
        if (authResult) {
          this.updateToolFilter(filterId, [], authResult.error);
          return authResult;
        }

        const error = "HTTP 401 - Authentication required";
        this.updateToolFilter(filterId, [], error);
        return { success: false, error, toolCount: 0, requiresAuth: true };
      }

      if (!toolsResponse.ok) {
        const error = `HTTP ${toolsResponse.status}`;
        this.updateToolFilter(filterId, [], error);
        return { success: false, error, toolCount: 0 };
      }

      // Parse response - handle both JSON and SSE
      let result: McpToolsResponse;
      const contentType = toolsResponse.headers.get("content-type") || "";

      if (contentType.includes("text/event-stream")) {
        // Read only the first SSE data event so we don't wait for long-lived streams
        const reader = toolsResponse.body?.getReader();
        if (!reader) {
          const error = "No response body for SSE";
          this.updateToolFilter(filterId, [], error);
          return { success: false, error, toolCount: 0 };
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let parsed: McpToolsResponse | null = null;

        try {
          while (!parsed) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;

              const data = trimmed.slice(5).trim();
              if (!data || data === "[DONE]") continue;

              if (data.startsWith("{")) {
                try {
                  parsed = JSON.parse(data) as McpToolsResponse;
                  break;
                } catch (error) {
                  // Keep reading if first chunk is not parseable JSON
                  log.debug("Failed to parse SSE chunk, continuing:", error);
                }
              }
            }
          }
        } finally {
          // Stop reading the stream after first event to avoid waiting for a long-lived connection
          try {
            await reader.cancel();
          } catch {
            // Ignore cancellation errors
          }
        }

        if (!parsed) {
          const error = "No JSON data in SSE response";
          this.updateToolFilter(filterId, [], error);
          return { success: false, error, toolCount: 0 };
        }

        result = parsed;
      } else {
        // Parse JSON response
        result = (await toolsResponse.json()) as McpToolsResponse;
      }

      if (result.result?.tools) {
        const tools = result.result.tools;
        this.updateToolFilter(filterId, tools);
        return { success: true, toolCount: tools.length };
      }

      const error = "No tools in response";
      this.updateToolFilter(filterId, [], error);
      return { success: false, error, toolCount: 0 };
    } catch (err) {
      const error =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Timeout"
            : err.message
          : "Unknown error";
      this.updateToolFilter(filterId, [], error);
      return { success: false, error, toolCount: 0 };
    }
  }

  /** Test a remote SSE server using the MCP SDK */
  private async testRemoteServerWithSDK(
    server: RemoteServer,
    skipAuth: boolean = false
  ): Promise<ExtendedServerTestResult> {
    const filterId = `remote:${server.id}`;

    try {
      const url = new URL(server.url);
      const headers: Record<string, string> = {};

      // Get auth headers
      const authHeaders = await this.getAuthHeaders(server);
      Object.assign(headers, authHeaders);

      // Create SSE transport
      const transport = new SSEClientTransport(url, {
        requestInit: { headers },
      });

      // Create client with timeout
      const client = new Client({ name: "mcp-tester", version: "1.0.0" }, { capabilities: {} });

      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), this.testTimeout);
      });

      // Connect with timeout
      await Promise.race([client.connect(transport), timeoutPromise]);

      // Get tools
      const toolsResult = await Promise.race([client.listTools(), timeoutPromise]);

      const tools = toolsResult.tools || [];

      // Close connection
      try {
        await client.close();
      } catch {
        // Ignore close errors
      }

      // Update tool filter
      this.updateToolFilter(filterId, tools);

      return {
        success: true,
        toolCount: tools.length,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";

      // Check for 401 errors
      if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
        if (skipAuth) {
          const error = "HTTP 401 - Authentication required";
          this.updateToolFilter(filterId, [], error);
          return { success: false, error, toolCount: 0, requiresAuth: true };
        }

        // Try to handle unauthorized
        const error = "HTTP 401 - Authentication required";
        this.updateToolFilter(filterId, [], error);
        return { success: false, error, toolCount: 0, requiresAuth: true };
      }

      const error = errorMessage === "Timeout" ? "Timeout" : errorMessage;
      this.updateToolFilter(filterId, [], error);
      return { success: false, error, toolCount: 0 };
    }
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
