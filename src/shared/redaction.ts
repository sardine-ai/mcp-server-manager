/**
 * Helpers to remove or mask sensitive values before showing them in the UI/CLI.
 */

import type { LocalServer, RemoteServer, OAuthConfig } from "../types/index.js";
import { isLocalServer } from "../types/index.js";

const REDACTED_VALUE = "***redacted***";

function redactOAuth(oauth?: OAuthConfig): OAuthConfig | undefined {
  if (!oauth) return undefined;
  const sanitized: OAuthConfig = { ...oauth };
  if ("clientSecret" in sanitized && sanitized.clientSecret) {
    sanitized.clientSecret = REDACTED_VALUE;
  }
  return sanitized;
}

/** Return a copy of a server with secrets masked for display */
export function redactServerForOutput(
  server: LocalServer | RemoteServer
): LocalServer | RemoteServer {
  if (isLocalServer(server)) {
    const env =
      server.env && Object.fromEntries(Object.keys(server.env).map((key) => [key, REDACTED_VALUE]));
    return {
      ...server,
      ...(env ? { env } : {}),
    };
  }

  const remote: RemoteServer = { ...server };

  if (remote.oauth) {
    remote.oauth = redactOAuth(remote.oauth);
  }

  if (remote.bearerToken) {
    remote.bearerToken = REDACTED_VALUE;
  }

  if (remote.headers) {
    remote.headers = Object.fromEntries(
      Object.keys(remote.headers).map((key) => [key, REDACTED_VALUE])
    );
  }

  return remote;
}

export const REDACTED_PLACEHOLDER = REDACTED_VALUE;
