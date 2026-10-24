import crypto from "crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { RemoteServer, StoredOAuthTokens } from "../types/index.js";
import AuthService, { TOKEN_REFRESH_THRESHOLD_MS } from "./auth.service.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("TransportAuthProvider");

/** Default redirect URI placeholder (only used if a fresh login is required) */
const DEFAULT_REDIRECT_URL = new URL("http://127.0.0.1:8400/callback");

function toOAuthTokens(stored: StoredOAuthTokens): OAuthTokens {
  return {
    access_token: stored.accessToken,
    refresh_token: stored.refreshToken,
    token_type: stored.tokenType,
    scope: stored.scopes?.join(" "),
    expires_in: stored.expiresAt
      ? Math.max(Math.floor((stored.expiresAt - Date.now()) / 1000), 0)
      : undefined,
  };
}

function mergeAndSaveTokens(
  authService: AuthService,
  server: RemoteServer,
  oauthTokens: OAuthTokens
): StoredOAuthTokens {
  const existing = authService.getToken(server.id) || undefined;

  const merged: StoredOAuthTokens = {
    accessToken: oauthTokens.access_token,
    refreshToken: oauthTokens.refresh_token ?? existing?.refreshToken,
    tokenType: oauthTokens.token_type || existing?.tokenType || "Bearer",
    scopes: oauthTokens.scope ? oauthTokens.scope.split(" ") : existing?.scopes,
    expiresAt: oauthTokens.expires_in
      ? Date.now() + oauthTokens.expires_in * 1000
      : existing?.expiresAt,
    clientId: existing?.clientId ?? server.oauth?.clientId,
    clientSecret: existing?.clientSecret ?? server.oauth?.clientSecret,
  };

  authService.saveTokensForServer(server.id, merged);
  return merged;
}

/** Create an OAuth client provider that automatically refreshes tokens for transports */
export function createTransportAuthProvider(
  server: RemoteServer,
  authService: AuthService
): OAuthClientProvider {
  let cachedCodeVerifier: string | null = null;

  const ensureFreshTokens = async (): Promise<StoredOAuthTokens | undefined> => {
    const stored = authService.getToken(server.id) || undefined;
    if (!stored) {
      return undefined;
    }

    const isExpiring =
      stored.expiresAt !== undefined &&
      stored.refreshToken &&
      stored.expiresAt - Date.now() < TOKEN_REFRESH_THRESHOLD_MS;

    if (isExpiring) {
      log.debug(`Refreshing OAuth token for ${server.name} before expiry`);
      const refreshed = await authService.refreshTokenWithMutex(server, stored);
      if (refreshed) {
        return refreshed;
      }

      // If the access token hasn't fully expired yet, return existing tokens
      if (stored.expiresAt && stored.expiresAt > Date.now()) {
        log.warn(
          `Token refresh failed for ${server.name}, but token not yet expired — using existing`
        );
        return stored;
      }

      // Fully expired — return undefined but preserve refresh token for future attempts
      log.warn(
        `Token refresh failed for ${server.name} and token is expired — NOT deleting refresh token`
      );
      return undefined;
    }

    return stored;
  };

  return {
    redirectUrl: DEFAULT_REDIRECT_URL,
    clientMetadata: {
      client_name: "MCP Server Manager",
      redirect_uris: [DEFAULT_REDIRECT_URL.toString()],
      software_id: "mcp-server-manager",
      software_version: "1.2.1",
      scope: server.oauth?.scopes?.join(" "),
    },
    async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
      const stored = authService.getToken(server.id);
      const clientId = server.oauth?.clientId || stored?.clientId;
      const clientSecret = server.oauth?.clientSecret || stored?.clientSecret;

      if (!clientId) {
        // Fallback to a stable identifier so refresh requests have a client_id
        return { client_id: server.url };
      }

      return clientSecret
        ? { client_id: clientId, client_secret: clientSecret }
        : { client_id: clientId };
    },
    async tokens(): Promise<OAuthTokens | undefined> {
      const current = await ensureFreshTokens();
      if (!current) {
        return undefined;
      }

      return toOAuthTokens(current);
    },
    async saveTokens(tokens: OAuthTokens): Promise<void> {
      mergeAndSaveTokens(authService, server, tokens);
    },
    async redirectToAuthorization(url: URL): Promise<never> {
      log.warn(
        `OAuth authorization required for ${server.name}. Run "mcpsm auth login ${server.id}" to re-authenticate. (${url.toString()})`
      );
      throw new Error(`Authorization required for ${server.name}`);
    },
    async saveCodeVerifier(verifier: string): Promise<void> {
      cachedCodeVerifier = verifier;
    },
    async codeVerifier(): Promise<string> {
      return cachedCodeVerifier || "";
    },
    async state(): Promise<string> {
      return crypto.randomUUID();
    },
    async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
      if (scope === "all" || scope === "tokens") {
        // Preserve the refresh token so the next tokens() call can attempt a refresh
        const stored = authService.getToken(server.id);
        if (stored?.refreshToken) {
          log.debug(`Invalidating access token for ${server.name} but preserving refresh token`);
          authService.saveTokensForServer(server.id, {
            ...stored,
            accessToken: "",
            expiresAt: 0,
          });
        } else {
          authService.removeToken(server.id);
        }
      }
      if (scope === "all" || scope === "client") {
        const stored = authService.getToken(server.id);
        if (stored) {
          const { clientId: _clientId, clientSecret: _clientSecret, ...rest } = stored;
          authService.saveTokensForServer(server.id, rest);
        }
      }
      if (scope === "all" || scope === "verifier") {
        cachedCodeVerifier = null;
      }
    },
  };
}

export default createTransportAuthProvider;
