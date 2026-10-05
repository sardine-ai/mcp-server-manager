/**
 * OAuth Authentication service for MCP servers
 * Implements OAuth 2.1 with PKCE following the MCP specification
 */

import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "http";
import { URL, URLSearchParams } from "url";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type {
  AuthServerMetadata,
  ProtectedResourceMetadata,
  PKCEData,
  PendingAuthorization,
  TokenResponse,
  AuthResult,
  ClientRegistration,
  ClientRegistrationRequest,
  ServerAuthRequirements,
  StoredOAuthTokens,
  RemoteServer,
} from "../types/index.js";
import { createLogger } from "../shared/logger.js";
import { renderCallbackPage } from "./auth-callback.html.js";
import {
  applyPrivateMode,
  ensurePrivateDirectory,
  PRIVATE_DIR_MODE,
  protectExistingPrivateFile,
  writePrivateFile,
  writePrivateJsonFile,
} from "../shared/secure-storage.js";

const log = createLogger("AuthService");

/** Default callback port range */
const CALLBACK_PORT_START = 8400;
const CALLBACK_PORT_END = 8450;

/** Token storage file name */
const TOKENS_FILE = "oauth-tokens.json";

/** Pending authorizations storage */
const PENDING_AUTH_FILE = "pending-auth.json";

/** Default timeout for OAuth flow (5 minutes) */
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/** Token refresh threshold (refresh 5 minutes before expiry) */
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

/** MCP Client information for registration */
const MCP_CLIENT_INFO = {
  client_name: "MCP Server Manager",
  software_id: "mcp-server-manager",
  software_version: "1.2.1",
};

/**
 * OAuth Authentication Service
 */
/** Proactive refresh retry config */
const PROACTIVE_REFRESH_MARGIN_MS = 10 * 60 * 1000; // 10 minutes before expiry
const PROACTIVE_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 240_000, 480_000]; // exponential backoff

export class AuthService {
  private configDir: string;
  private legacyConfigDirs: string[];
  private tokensPath: string;
  private pendingAuthPath: string;
  private tokens: Map<string, StoredOAuthTokens>;
  private pendingAuths: Map<string, PendingAuthorization>;
  private callbackServer: HttpServer | null = null;
  private callbackPort: number | null = null;

  /** Per-server refresh mutex to prevent concurrent refresh requests */
  private refreshMutexes: Map<string, Promise<StoredOAuthTokens | null>> = new Map();
  /** Proactive refresh timers keyed by server ID */
  private refreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Retry counts for proactive refresh */
  private refreshRetryCounts: Map<string, number> = new Map();

  constructor(configDir?: string) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || "";
    const defaultConfigDir = path.join(homeDir, ".mcp-manager");
    const defaultLegacyConfigDir = path.join(homeDir, ".mcpsm");
    const shouldUseDefaultPaths =
      !configDir && !process.env.MCP_MANAGER_CONFIG_DIR && !process.env.MCPSM_CONFIG_DIR;
    const shouldMigrateLegacyEnv = !configDir && !!process.env.MCP_MANAGER_CONFIG_DIR;

    this.configDir =
      configDir ||
      process.env.MCP_MANAGER_CONFIG_DIR ||
      process.env.MCPSM_CONFIG_DIR ||
      defaultConfigDir;
    this.legacyConfigDirs = Array.from(
      new Set(
        [
          shouldMigrateLegacyEnv ? process.env.MCPSM_CONFIG_DIR : undefined,
          shouldUseDefaultPaths ? defaultLegacyConfigDir : undefined,
        ].filter(Boolean) as string[]
      )
    );

    this.tokensPath = path.join(this.configDir, TOKENS_FILE);
    this.pendingAuthPath = path.join(this.configDir, PENDING_AUTH_FILE);
    this.tokens = new Map();
    this.pendingAuths = new Map();

    this.ensureConfigDir();
    this.migrateLegacyTokens();
    this.loadTokens();
    this.loadPendingAuths();
  }

  /** Ensure config directory exists */
  private ensureConfigDir(): void {
    ensurePrivateDirectory(this.configDir);
  }

  /** Move legacy OAuth tokens into the main config directory when no new file exists yet */
  private migrateLegacyTokens(): void {
    for (const legacyConfigDir of this.legacyConfigDirs) {
      if (legacyConfigDir === this.configDir) continue;

      const legacyTokensPath = path.join(legacyConfigDir, TOKENS_FILE);

      if (fs.existsSync(legacyConfigDir)) {
        applyPrivateMode(legacyConfigDir, PRIVATE_DIR_MODE);
      }

      protectExistingPrivateFile(legacyTokensPath);

      if (!fs.existsSync(this.tokensPath) && fs.existsSync(legacyTokensPath)) {
        writePrivateFile(this.tokensPath, fs.readFileSync(legacyTokensPath, "utf8"));
      }
    }
  }

  /** Load stored tokens from disk */
  private loadTokens(): void {
    try {
      if (fs.existsSync(this.tokensPath)) {
        protectExistingPrivateFile(this.tokensPath);
        const data = fs.readFileSync(this.tokensPath, "utf8");
        const parsed = JSON.parse(data) as Record<string, StoredOAuthTokens>;
        this.tokens = new Map(Object.entries(parsed));
      }
    } catch (error) {
      log.debug("Failed to load OAuth tokens:", error);
      this.tokens = new Map();
    }
  }

  /** Save tokens to disk */
  private saveTokens(): void {
    try {
      const data = Object.fromEntries(this.tokens);
      writePrivateJsonFile(this.tokensPath, data);
    } catch (error) {
      log.debug("Failed to save OAuth tokens:", error);
    }
  }

  /** Load pending authorizations from disk */
  private loadPendingAuths(): void {
    try {
      if (fs.existsSync(this.pendingAuthPath)) {
        protectExistingPrivateFile(this.pendingAuthPath);
        const data = fs.readFileSync(this.pendingAuthPath, "utf8");
        const parsed = JSON.parse(data) as Record<string, PendingAuthorization>;

        // Clean up expired pending auths
        const now = Date.now();
        for (const [key, auth] of Object.entries(parsed)) {
          if (now - auth.createdAt < AUTH_TIMEOUT_MS) {
            this.pendingAuths.set(key, auth);
          }
        }
      }
    } catch (error) {
      log.debug("Failed to load pending authorizations:", error);
      this.pendingAuths = new Map();
    }
  }

  /** Save pending authorizations to disk */
  private savePendingAuths(): void {
    try {
      const data = Object.fromEntries(this.pendingAuths);
      writePrivateJsonFile(this.pendingAuthPath, data);
    } catch (error) {
      log.debug("Failed to save pending authorizations:", error);
    }
  }

  // === PKCE Implementation ===

  /** Generate cryptographically secure random string */
  private generateRandomString(length: number): string {
    const bytes = crypto.randomBytes(length);
    return bytes
      .toString("base64url")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, length);
  }

  /** Generate PKCE code verifier and challenge */
  generatePKCE(): PKCEData {
    // Generate a random code verifier (43-128 characters)
    const codeVerifier = this.generateRandomString(64);

    // Generate code challenge using SHA-256
    const hash = crypto.createHash("sha256").update(codeVerifier).digest();
    const codeChallenge = hash.toString("base64url");

    return {
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: "S256",
    };
  }

  /** Generate random state parameter */
  generateState(): string {
    return this.generateRandomString(32);
  }

  // === Server Metadata Discovery ===

  /** Parse WWW-Authenticate header to extract auth requirements */
  parseWWWAuthenticate(header: string): ServerAuthRequirements {
    const result: ServerAuthRequirements = { requiresAuth: true };

    // Parse Bearer scheme parameters
    const bearerMatch = header.match(/Bearer\s+(.+)/i);
    if (!bearerMatch) {
      return result;
    }

    const params = bearerMatch[1];

    // Extract realm
    const realmMatch = params.match(/realm="([^"]+)"/);
    if (realmMatch) {
      result.realm = realmMatch[1];
    }

    // Extract resource_metadata URL (RFC 9728)
    const resourceMetadataMatch = params.match(/resource_metadata="([^"]+)"/);
    if (resourceMetadataMatch) {
      result.resourceMetadataUrl = resourceMetadataMatch[1];
    }

    // Extract scope
    const scopeMatch = params.match(/scope="([^"]+)"/);
    if (scopeMatch) {
      result.scope = scopeMatch[1];
    }

    // Extract error
    const errorMatch = params.match(/error="([^"]+)"/);
    if (errorMatch) {
      result.error = errorMatch[1];
    }

    // Extract error_description
    const errorDescMatch = params.match(/error_description="([^"]+)"/);
    if (errorDescMatch) {
      result.errorDescription = errorDescMatch[1];
    }

    return result;
  }

  /** Fetch protected resource metadata (RFC 9728) */
  async fetchProtectedResourceMetadata(
    serverUrl: string,
    metadataUrl?: string
  ): Promise<ProtectedResourceMetadata | null> {
    try {
      let url: string;

      if (metadataUrl) {
        url = metadataUrl;
      } else {
        // Try well-known URI as per RFC 9728
        const serverUri = new URL(serverUrl);
        const pathPrefix = serverUri.pathname !== "/" ? serverUri.pathname : "";
        url = `${serverUri.origin}/.well-known/oauth-protected-resource${pathPrefix}`;
      }

      log.debug("Fetching protected resource metadata from:", url);

      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        log.debug("Protected resource metadata not found at:", url);
        return null;
      }

      const metadata = (await response.json()) as ProtectedResourceMetadata;
      return metadata;
    } catch (error) {
      log.debug("Error fetching protected resource metadata:", error);
      return null;
    }
  }

  /** Fetch authorization server metadata (RFC 8414) */
  async fetchAuthServerMetadata(authServerUrl: string): Promise<AuthServerMetadata | null> {
    try {
      const serverUri = new URL(authServerUrl);

      // Try OAuth 2.0 Authorization Server Metadata first (RFC 8414)
      const wellKnownUrls = [
        `${serverUri.origin}/.well-known/oauth-authorization-server${serverUri.pathname !== "/" ? serverUri.pathname : ""}`,
        `${serverUri.origin}/.well-known/oauth-authorization-server`,
        `${serverUri.origin}/.well-known/openid-configuration`,
        `${serverUri.origin}${serverUri.pathname !== "/" ? serverUri.pathname : ""}/.well-known/openid-configuration`,
      ];

      for (const url of wellKnownUrls) {
        try {
          log.debug("Trying auth server metadata at:", url);
          const response = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
          });

          if (response.ok) {
            const metadata = (await response.json()) as AuthServerMetadata;
            if (metadata.authorization_endpoint && metadata.token_endpoint) {
              log.debug("Found auth server metadata at:", url);
              return metadata;
            }
          }
        } catch {
          continue;
        }
      }

      return null;
    } catch (error) {
      log.debug("Error fetching auth server metadata:", error);
      return null;
    }
  }

  /** Discover authorization server for a remote server */
  async discoverAuthServer(
    server: RemoteServer,
    authRequirements?: ServerAuthRequirements
  ): Promise<{
    metadata: AuthServerMetadata;
    resourceMetadata?: ProtectedResourceMetadata;
  } | null> {
    try {
      // First, try to get protected resource metadata
      const resourceMetadata = await this.fetchProtectedResourceMetadata(
        server.url,
        authRequirements?.resourceMetadataUrl
      );

      let authServerUrl: string | undefined;

      if (resourceMetadata?.authorization_servers?.length) {
        authServerUrl = resourceMetadata.authorization_servers[0];
      } else if (server.oauth?.authServerUrl) {
        authServerUrl = server.oauth.authServerUrl;
      } else {
        // Fall back to using the server's URL as the auth server
        const serverUri = new URL(server.url);
        authServerUrl = serverUri.origin;
      }

      if (!authServerUrl) {
        log.debug("No authorization server URL found for server:", server.id);
        return null;
      }

      const metadata = await this.fetchAuthServerMetadata(authServerUrl);
      if (!metadata) {
        log.debug("Could not fetch auth server metadata for:", authServerUrl);
        return null;
      }

      return { metadata, resourceMetadata: resourceMetadata || undefined };
    } catch (error) {
      log.debug("Error discovering auth server:", error);
      return null;
    }
  }

  // === Dynamic Client Registration ===

  /** Register client dynamically with authorization server (RFC 7591) */
  async registerClient(
    registrationEndpoint: string,
    redirectUri: string
  ): Promise<ClientRegistration | null> {
    try {
      const request: ClientRegistrationRequest = {
        redirect_uris: [redirectUri],
        client_name: MCP_CLIENT_INFO.client_name,
        token_endpoint_auth_method: "none", // Public client
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        software_id: MCP_CLIENT_INFO.software_id,
        software_version: MCP_CLIENT_INFO.software_version,
      };

      const response = await fetch(registrationEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.debug("Client registration failed:", errorText);
        return null;
      }

      const registration = (await response.json()) as ClientRegistration;
      return registration;
    } catch (error) {
      log.debug("Error registering client:", error);
      return null;
    }
  }

  // === Callback Server ===

  /** Find an available port for the callback server */
  private async findAvailablePort(): Promise<number> {
    for (let port = CALLBACK_PORT_START; port <= CALLBACK_PORT_END; port++) {
      const available = await new Promise<boolean>((resolve) => {
        const server = createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
          server.close();
          resolve(true);
        });
        server.listen(port, "127.0.0.1");
      });

      if (available) {
        return port;
      }
    }

    throw new Error("No available port found for OAuth callback server");
  }

  /** Start the callback server to receive OAuth redirects */
  async startCallbackServer(): Promise<string> {
    if (this.callbackServer) {
      return `http://127.0.0.1:${this.callbackPort}/callback`;
    }

    this.callbackPort = await this.findAvailablePort();

    return new Promise((resolve, reject) => {
      this.callbackServer = createServer((req: IncomingMessage, res: ServerResponse) => {
        this.handleCallback(req, res);
      });

      this.callbackServer.once("error", (err) => {
        this.callbackServer = null;
        this.callbackPort = null;
        reject(err);
      });

      const port = this.callbackPort;
      if (!port) {
        reject(new Error("Callback port not set"));
        return;
      }

      this.callbackServer.listen(port, "127.0.0.1", () => {
        log.debug(`OAuth callback server listening on port ${port}`);
        resolve(`http://127.0.0.1:${port}/callback`);
      });
    });
  }

  /** Stop the callback server */
  stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
      this.callbackPort = null;
      log.debug("OAuth callback server stopped");
    }
  }

  /** Handle OAuth callback */
  private handleCallback(req: IncomingMessage, res: ServerResponse): void {
    // Check if we have a valid port (use local variable for type narrowing)
    const port = this.callbackPort;
    if (!port) {
      log.warn("OAuth callback received but server port is null");
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Callback server not properly initialized");
      return;
    }

    const url = new URL(req.url || "", `http://127.0.0.1:${port}`);

    if (url.pathname !== "/callback") {
      // Silently ignore favicon and other non-callback requests
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (error) {
      // Handle error response
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCallbackPage("error", errorDescription || error));

      // Emit error event for pending auth
      if (state) {
        this.handleAuthError(state, error, errorDescription || undefined);
      }
      return;
    }

    if (!code || !state) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderCallbackPage("error", "Missing authorization code or state parameter."));
      return;
    }

    // Process the callback in the background
    this.processCallback(state, code)
      .then((result) => {
        if (result.success) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCallbackPage("success"));
        } else {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCallbackPage("error", result.error || "Unknown error"));
        }
      })
      .catch((err) => {
        log.debug("Callback processing error:", err);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCallbackPage("error", "An unexpected error occurred."));
      });
  }

  /** Handle auth error from callback */
  private handleAuthError(state: string, error: string, description?: string): void {
    const pendingAuth = this.pendingAuths.get(state);
    if (pendingAuth) {
      this.pendingAuths.delete(state);
      this.savePendingAuths();
      log.debug(`Auth error for ${pendingAuth.serverId}: ${error} - ${description}`);
    }
  }

  /** Process OAuth callback and exchange code for tokens */
  private async processCallback(state: string, code: string): Promise<AuthResult> {
    const pendingAuth = this.pendingAuths.get(state);
    if (!pendingAuth) {
      return { success: false, error: "Invalid or expired authorization state" };
    }

    try {
      // Exchange authorization code for tokens
      const tokenParams = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: pendingAuth.redirectUri,
        client_id: pendingAuth.clientId,
        code_verifier: pendingAuth.pkce.codeVerifier,
      });

      if (pendingAuth.clientSecret) {
        tokenParams.set("client_secret", pendingAuth.clientSecret);
      }

      const response = await fetch(pendingAuth.tokenEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: tokenParams.toString(),
      });

      if (!response.ok) {
        const errorData = await response.text();
        log.debug("Token exchange failed:", errorData);
        return { success: false, error: `Token exchange failed: ${response.status}` };
      }

      const tokenResponse = (await response.json()) as TokenResponse;

      // Store the tokens
      const storedTokens: StoredOAuthTokens = {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || "Bearer",
        refreshToken: tokenResponse.refresh_token,
        scopes: tokenResponse.scope?.split(" "),
        clientId: pendingAuth.clientId,
        clientSecret: pendingAuth.clientSecret,
        expiresAt: tokenResponse.expires_in
          ? Date.now() + tokenResponse.expires_in * 1000
          : undefined,
      };

      this.tokens.set(pendingAuth.serverId, storedTokens);
      this.saveTokens();

      // Clean up pending auth
      this.pendingAuths.delete(state);
      this.savePendingAuths();

      log.debug(`Successfully authenticated server: ${pendingAuth.serverId}`);

      return {
        success: true,
        token: tokenResponse.access_token,
        expiresAt: storedTokens.expiresAt,
        refreshToken: tokenResponse.refresh_token,
      };
    } catch (error) {
      log.debug("Error processing callback:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // === Authorization Flow ===

  /** Build authorization URL for a server */
  async buildAuthorizationUrl(
    server: RemoteServer,
    metadata: AuthServerMetadata,
    redirectUri: string,
    clientId: string,
    clientSecret?: string,
    scopes?: string[]
  ): Promise<{ url: string; state: string; pkce: PKCEData }> {
    const pkce = this.generatePKCE();
    const state = this.generateState();

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: pkce.codeChallengeMethod,
    });

    // Add scopes if specified
    if (scopes?.length) {
      params.set("scope", scopes.join(" "));
    } else if (server.oauth?.scopes?.length) {
      params.set("scope", server.oauth.scopes.join(" "));
    } else if (metadata.scopes_supported?.length) {
      params.set("scope", metadata.scopes_supported.join(" "));
    }

    // Add resource parameter (RFC 8707)
    params.set("resource", server.url);

    const url = `${metadata.authorization_endpoint}?${params.toString()}`;

    // Store pending authorization
    const pendingAuth: PendingAuthorization = {
      serverId: server.id,
      serverUrl: server.url,
      pkce,
      state,
      redirectUri,
      authorizationEndpoint: metadata.authorization_endpoint,
      tokenEndpoint: metadata.token_endpoint,
      clientId,
      clientSecret,
      scopes,
      createdAt: Date.now(),
    };

    this.pendingAuths.set(state, pendingAuth);
    this.savePendingAuths();

    return { url, state, pkce };
  }

  /** Start OAuth flow for a server */
  async startOAuthFlow(
    server: RemoteServer,
    authRequirements?: ServerAuthRequirements
  ): Promise<{ authUrl: string; state: string } | null> {
    try {
      // Discover authorization server
      const discovery = await this.discoverAuthServer(server, authRequirements);
      if (!discovery) {
        log.debug("Could not discover authorization server for:", server.id);
        return null;
      }

      const { metadata, resourceMetadata } = discovery;

      // Start callback server
      const redirectUri = await this.startCallbackServer();

      // Determine client ID
      let clientId = server.oauth?.clientId;
      let clientSecret = server.oauth?.clientSecret;

      // If no pre-registered client, try dynamic registration
      if (!clientId && metadata.registration_endpoint) {
        log.debug("Attempting dynamic client registration...");
        const registration = await this.registerClient(metadata.registration_endpoint, redirectUri);
        if (registration) {
          clientId = registration.client_id;
          clientSecret = registration.client_secret;
        }
      }

      // If still no client ID, use the redirect URI as client ID (Client ID Metadata Document)
      if (!clientId) {
        clientId = redirectUri;
      }

      // Determine scopes
      const scopes =
        server.oauth?.scopes ||
        (authRequirements?.scope ? [authRequirements.scope] : undefined) ||
        resourceMetadata?.scopes_supported;

      // Build authorization URL
      const { url, state } = await this.buildAuthorizationUrl(
        server,
        metadata,
        redirectUri,
        clientId,
        clientSecret,
        scopes
      );

      return { authUrl: url, state };
    } catch (error) {
      log.debug("Error starting OAuth flow:", error);
      return null;
    }
  }

  /** Wait for OAuth completion */
  async waitForAuth(state: string, timeoutMs: number = AUTH_TIMEOUT_MS): Promise<AuthResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      // Get the pending auth to know which server we're waiting for
      const initialPendingAuth = this.pendingAuths.get(state);
      if (!initialPendingAuth) {
        resolve({ success: false, error: "No pending authorization found" });
        return;
      }

      const serverId = initialPendingAuth.serverId;
      // Track the token state before auth started
      const tokenBeforeAuth = this.tokens.get(serverId)?.accessToken;

      const checkAuth = (): void => {
        // Check if auth is still pending
        const pendingAuth = this.pendingAuths.get(state);

        if (!pendingAuth) {
          // Auth completed (either success or failure)
          // Check if we have a NEW token for this specific server
          const currentToken = this.tokens.get(serverId);
          if (currentToken?.accessToken && currentToken.accessToken !== tokenBeforeAuth) {
            // New token was added - success
            resolve({
              success: true,
              token: currentToken.accessToken,
              expiresAt: currentToken.expiresAt,
              refreshToken: currentToken.refreshToken,
            });
            return;
          }
          // No new token - auth was cancelled or failed
          resolve({ success: false, error: "Authorization was cancelled or failed" });
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          this.pendingAuths.delete(state);
          this.savePendingAuths();
          resolve({ success: false, error: "Authorization timeout" });
          return;
        }

        // Continue waiting
        setTimeout(checkAuth, 500);
      };

      checkAuth();
    });
  }

  // === Token Management ===

  /** Get stored token for a server */
  getToken(serverId: string): StoredOAuthTokens | null {
    return this.tokens.get(serverId) || null;
  }

  /** Save/overwrite stored tokens for a server */
  saveTokensForServer(serverId: string, tokens: StoredOAuthTokens): void {
    this.tokens.set(serverId, tokens);
    this.saveTokens();
    // Note: proactive refresh rescheduling requires a RemoteServer object,
    // so it's handled by the caller or by scheduleRefreshForServer() directly.
  }

  /** Get valid access token for a server (refreshes if needed) */
  async getValidToken(server: RemoteServer): Promise<string | null> {
    const stored = this.tokens.get(server.id);
    if (!stored) {
      return null;
    }

    // Check if token is expired or about to expire
    if (stored.expiresAt && stored.expiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
      if (stored.refreshToken) {
        // Try to refresh the token
        const refreshed = await this.refreshToken(server, stored);
        if (refreshed) {
          return refreshed.accessToken;
        }
      }
      // Token expired and can't refresh
      return null;
    }

    return stored.accessToken;
  }

  /** Refresh access token using refresh token */
  async refreshToken(
    server: RemoteServer,
    stored: StoredOAuthTokens
  ): Promise<StoredOAuthTokens | null> {
    if (!stored.refreshToken) {
      return null;
    }

    try {
      // Discover auth server to get token endpoint
      const discovery = await this.discoverAuthServer(server);
      if (!discovery) {
        return null;
      }

      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: stored.refreshToken,
      });

      // Add client credentials if available (server config takes precedence)
      const clientId = server.oauth?.clientId || stored.clientId;
      const clientSecret = server.oauth?.clientSecret || stored.clientSecret;

      if (clientId) {
        params.set("client_id", clientId);
        if (clientSecret) {
          params.set("client_secret", clientSecret);
        }
      }

      const response = await fetch(discovery.metadata.token_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        log.debug("Token refresh failed:", response.status);
        return null;
      }

      const tokenResponse = (await response.json()) as TokenResponse;

      const newTokens: StoredOAuthTokens = {
        accessToken: tokenResponse.access_token,
        tokenType: tokenResponse.token_type || "Bearer",
        refreshToken: tokenResponse.refresh_token || stored.refreshToken,
        scopes: tokenResponse.scope?.split(" ") || stored.scopes,
        clientId,
        clientSecret,
        expiresAt: tokenResponse.expires_in
          ? Date.now() + tokenResponse.expires_in * 1000
          : undefined,
      };

      this.tokens.set(server.id, newTokens);
      this.saveTokens();

      return newTokens;
    } catch (error) {
      log.debug("Error refreshing token:", error);
      return null;
    }
  }

  /**
   * Refresh token with per-server mutex to prevent concurrent refresh requests.
   * If a refresh is already in-flight for this server, returns the same promise.
   */
  async refreshTokenWithMutex(
    server: RemoteServer,
    stored: StoredOAuthTokens
  ): Promise<StoredOAuthTokens | null> {
    const existing = this.refreshMutexes.get(server.id);
    if (existing) {
      log.debug(`Refresh already in-flight for ${server.name}, waiting...`);
      return existing;
    }

    const refreshPromise = this.refreshToken(server, stored).finally(() => {
      this.refreshMutexes.delete(server.id);
    });

    this.refreshMutexes.set(server.id, refreshPromise);
    return refreshPromise;
  }

  /**
   * Ensure a server has a valid token, attempting refresh if expired but refreshable.
   * Returns true if the server has a valid (or freshly refreshed) token.
   */
  async ensureValidToken(server: RemoteServer): Promise<boolean> {
    const stored = this.tokens.get(server.id);
    if (!stored) {
      return false;
    }

    // Token is still valid
    if (!stored.expiresAt || stored.expiresAt > Date.now()) {
      // Also check for empty access token (invalidated by SDK)
      if (stored.accessToken && stored.accessToken.length > 0) {
        return true;
      }
    }

    // Token expired or invalidated — try refresh
    if (stored.refreshToken) {
      log.debug(`Token expired for ${server.name}, attempting refresh...`);
      const refreshed = await this.refreshTokenWithMutex(server, stored);
      return refreshed !== null;
    }

    return false;
  }

  // === Proactive Refresh Scheduling ===

  /**
   * Start proactive refresh timers for all servers with refresh tokens.
   * @param servers List of remote servers to monitor
   * @param onRefreshed Callback when a server's token is successfully refreshed
   */
  startProactiveRefresh(servers: RemoteServer[], onRefreshed?: (serverId: string) => void): void {
    this.stopProactiveRefresh();
    log.debug(`Starting proactive refresh for ${servers.length} server(s)`);

    for (const server of servers) {
      this.scheduleRefreshForServer(server, onRefreshed);
    }
  }

  /** Stop all proactive refresh timers */
  stopProactiveRefresh(): void {
    for (const [serverId, timer] of this.refreshTimers) {
      clearTimeout(timer);
      log.debug(`Stopped proactive refresh timer for ${serverId}`);
    }
    this.refreshTimers.clear();
    this.refreshRetryCounts.clear();
  }

  /**
   * Schedule a proactive refresh for a single server.
   * Called automatically when tokens are saved.
   */
  scheduleRefreshForServer(server: RemoteServer, onRefreshed?: (serverId: string) => void): void {
    // Clear existing timer for this server
    const existingTimer = this.refreshTimers.get(server.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    this.refreshRetryCounts.delete(server.id);

    const stored = this.tokens.get(server.id);
    if (!stored?.refreshToken || !stored.expiresAt) {
      return;
    }

    // Schedule refresh 10 minutes before expiry
    const refreshAt = stored.expiresAt - PROACTIVE_REFRESH_MARGIN_MS;
    const delay = Math.max(refreshAt - Date.now(), 1000); // at least 1 second

    log.debug(`Scheduling proactive refresh for ${server.name} in ${Math.round(delay / 1000)}s`);

    const timer = setTimeout(() => {
      this.executeProactiveRefresh(server, onRefreshed);
    }, delay);

    // Don't let the timer keep the process alive
    if (timer.unref) {
      timer.unref();
    }

    this.refreshTimers.set(server.id, timer);
  }

  /** Execute a proactive refresh with exponential backoff on failure */
  private async executeProactiveRefresh(
    server: RemoteServer,
    onRefreshed?: (serverId: string) => void
  ): Promise<void> {
    const stored = this.tokens.get(server.id);
    if (!stored?.refreshToken) {
      log.debug(`No refresh token for ${server.name}, skipping proactive refresh`);
      return;
    }

    log.debug(`Proactive refresh executing for ${server.name}`);

    try {
      const refreshed = await this.refreshTokenWithMutex(server, stored);

      if (refreshed) {
        log.info(`Proactive refresh succeeded for ${server.name}`);
        this.refreshRetryCounts.delete(server.id);
        // Schedule the next refresh based on new expiry
        this.scheduleRefreshForServer(server, onRefreshed);
        onRefreshed?.(server.id);
      } else {
        this.handleProactiveRefreshFailure(server, onRefreshed);
      }
    } catch (error) {
      log.warn(`Proactive refresh error for ${server.name}:`, error);
      this.handleProactiveRefreshFailure(server, onRefreshed);
    }
  }

  /** Handle proactive refresh failure with exponential backoff */
  private handleProactiveRefreshFailure(
    server: RemoteServer,
    onRefreshed?: (serverId: string) => void
  ): void {
    const retryCount = this.refreshRetryCounts.get(server.id) || 0;

    if (retryCount >= PROACTIVE_RETRY_DELAYS_MS.length) {
      log.warn(
        `Proactive refresh for ${server.name} exhausted all ${PROACTIVE_RETRY_DELAYS_MS.length} retries`
      );
      this.refreshTimers.delete(server.id);
      this.refreshRetryCounts.delete(server.id);
      return;
    }

    const delay = PROACTIVE_RETRY_DELAYS_MS[retryCount];
    log.warn(
      `Proactive refresh failed for ${server.name}, retry ${retryCount + 1}/${PROACTIVE_RETRY_DELAYS_MS.length} in ${delay / 1000}s`
    );

    this.refreshRetryCounts.set(server.id, retryCount + 1);

    const timer = setTimeout(() => {
      this.executeProactiveRefresh(server, onRefreshed);
    }, delay);

    if (timer.unref) {
      timer.unref();
    }

    this.refreshTimers.set(server.id, timer);
  }

  /** Check if a server has valid OAuth tokens */
  hasValidToken(serverId: string): boolean {
    const stored = this.tokens.get(serverId);
    if (!stored) {
      return false;
    }

    // Check expiration
    if (stored.expiresAt && stored.expiresAt < Date.now()) {
      return false;
    }

    return true;
  }

  /** Remove token for a server */
  removeToken(serverId: string): void {
    this.tokens.delete(serverId);
    this.saveTokens();
  }

  /** Clear all tokens */
  clearAllTokens(): void {
    this.tokens.clear();
    this.saveTokens();
  }

  /** Get all server IDs that have stored OAuth tokens */
  getAllStoredTokenServerIds(): string[] {
    return Array.from(this.tokens.keys());
  }

  /** Get token preview (masked) */
  getTokenPreview(serverId: string): string | null {
    const stored = this.tokens.get(serverId);
    if (!stored) {
      return null;
    }

    const token = stored.accessToken;
    if (token.length <= 8) {
      return "****";
    }

    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }

  /** Check if token is expired */
  isTokenExpired(serverId: string): boolean {
    const stored = this.tokens.get(serverId);
    if (!stored || !stored.expiresAt) {
      return false;
    }

    return stored.expiresAt < Date.now();
  }

  /** Check if token is expired but can be refreshed */
  isRefreshable(serverId: string): boolean {
    const stored = this.tokens.get(serverId);
    if (!stored) {
      return false;
    }

    if (this.isTokenExpired(serverId) && stored.refreshToken) {
      return true;
    }

    return false;
  }

  // === Utility Methods ===

  /** Check if a server requires OAuth */
  serverRequiresOAuth(server: RemoteServer): boolean {
    return server.oauth?.enabled === true;
  }

  /** Get all servers with pending auth */
  getPendingAuthServers(): string[] {
    return Array.from(this.pendingAuths.values()).map((p) => p.serverId);
  }

  /** Cancel pending auth for a server */
  cancelPendingAuth(serverId: string): void {
    for (const [state, auth] of this.pendingAuths) {
      if (auth.serverId === serverId) {
        this.pendingAuths.delete(state);
      }
    }
    this.savePendingAuths();
  }

  /** Clean up expired pending authorizations */
  cleanupExpiredAuths(): void {
    const now = Date.now();
    for (const [state, auth] of this.pendingAuths) {
      if (now - auth.createdAt > AUTH_TIMEOUT_MS) {
        this.pendingAuths.delete(state);
      }
    }
    this.savePendingAuths();
  }

  /** Open URL in default browser */
  async openBrowser(url: string): Promise<boolean> {
    try {
      const { default: open } = await import("open");
      await open(url);
      return true;
    } catch {
      // Fallback to platform-specific commands
      const { exec } = await import("child_process");
      const platform = process.platform;

      let command: string;
      if (platform === "darwin") {
        command = `open "${url}"`;
      } else if (platform === "win32") {
        command = `start "" "${url}"`;
      } else {
        command = `xdg-open "${url}"`;
      }

      return new Promise((resolve) => {
        exec(command, (error) => {
          if (error) {
            log.debug("Failed to open browser:", error);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
    }
  }

  /** Get pending authorization state for a server */
  getPendingAuthState(serverId: string): string | null {
    for (const [state, pending] of this.pendingAuths.entries()) {
      if (pending.serverId === serverId) {
        return state;
      }
    }
    return null;
  }

  /** Reload tokens and pending auths from disk (used by daemon refresh) */
  reload(): void {
    this.loadTokens();
    this.loadPendingAuths();
  }

  /** Get storage paths for watchers/diagnostics */
  getStoragePaths(): { configDir: string; tokensPath: string; pendingAuthPath: string } {
    return {
      configDir: this.configDir,
      tokensPath: this.tokensPath,
      pendingAuthPath: this.pendingAuthPath,
    };
  }
}

/** Singleton instance */
let instance: AuthService | null = null;

/** Get or create the auth service instance */
export function getAuthService(configDir?: string): AuthService {
  if (!instance) {
    instance = new AuthService(configDir);
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetAuthService(): void {
  if (instance) {
    instance.stopCallbackServer();
  }
  instance = null;
}

export default AuthService;
