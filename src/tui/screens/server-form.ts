import type { LocalServer, RemoteServer, Result, TransportType } from "../../types/index.js";
import { parseEnvInput, normalizeEnv } from "../../shared/env.js";
import { REDACTED_PLACEHOLDER } from "../../shared/redaction.js";

export enum Step {
  Name = "name",
  Type = "type",
  Command = "command",
  Args = "args",
  Env = "env",
  Url = "url",
  Token = "token",
  OauthToggle = "oauthToggle",
  ClientId = "clientId",
  ClientSecret = "clientSecret",
  Scopes = "scopes",
  AuthServer = "authServer",
  Testing = "testing",
  Authenticating = "authenticating",
  Done = "done",
}

export const STEP_LABELS: Record<Step, string> = {
  [Step.Name]: "Server Name",
  [Step.Type]: "Server Type",
  [Step.Command]: "Command",
  [Step.Args]: "Arguments",
  [Step.Env]: "Environment",
  [Step.Url]: "Server URL",
  [Step.Token]: "Bearer Token",
  [Step.OauthToggle]: "OAuth",
  [Step.ClientId]: "OAuth Client ID",
  [Step.ClientSecret]: "OAuth Secret",
  [Step.Scopes]: "OAuth Scopes",
  [Step.AuthServer]: "Auth Server",
  [Step.Testing]: "Testing",
  [Step.Authenticating]: "Authenticating",
  [Step.Done]: "Done",
};

export const LOCAL_STEPS: Step[] = [Step.Name, Step.Type, Step.Command, Step.Args, Step.Env];
export const REMOTE_STEPS: Step[] = [Step.Name, Step.Type, Step.Url, Step.Token, Step.OauthToggle];
export const REMOTE_OAUTH_STEPS: Step[] = [
  Step.Name,
  Step.Type,
  Step.Url,
  Step.Token,
  Step.OauthToggle,
  Step.ClientId,
  Step.ClientSecret,
  Step.Scopes,
  Step.AuthServer,
];

export type ServerType = "stdio" | TransportType;

export interface ServerFormFields {
  name: string;
  serverId: string;
  serverType: ServerType | null;
  command: string;
  args: string;
  env: string;
  url: string;
  token: string;
  oauthEnabled: boolean;
  clientId: string;
  clientSecret: string;
  scopes: string;
  authServerUrl: string;
}

export const DEFAULT_SERVER_FORM_FIELDS: ServerFormFields = {
  name: "",
  serverId: "",
  serverType: null,
  command: "",
  args: "",
  env: "",
  url: "",
  token: "",
  oauthEnabled: false,
  clientId: "",
  clientSecret: "",
  scopes: "",
  authServerUrl: "",
};

export function createServerFormFields(overrides?: Partial<ServerFormFields>): ServerFormFields {
  return { ...DEFAULT_SERVER_FORM_FIELDS, ...overrides };
}

export function parseArgs(value: string): string[] {
  const trimmed = value.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
}

export function getScopes(value: string): string[] {
  return value
    .split(/[ ,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveBearerToken(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed === REDACTED_PLACEHOLDER) {
    return undefined;
  }
  return trimmed;
}

function buildOAuthConfig(
  fields: ServerFormFields,
  includeDisabled = false
): RemoteServer["oauth"] | undefined {
  const clientId = fields.clientId.trim();
  const clientSecret = fields.clientSecret.trim();
  const authServerUrl = fields.authServerUrl.trim();
  const scopes = getScopes(fields.scopes);
  const hasDetails =
    fields.oauthEnabled || clientId || clientSecret || scopes.length > 0 || authServerUrl;

  if (!hasDetails && !includeDisabled) {
    return undefined;
  }

  const oauth: RemoteServer["oauth"] = {
    enabled: Boolean(hasDetails),
  };

  if (clientId) {
    oauth.clientId = clientId;
  }
  if (clientSecret) {
    oauth.clientSecret = clientSecret;
  }
  if (scopes.length > 0) {
    oauth.scopes = scopes;
  }
  if (authServerUrl) {
    oauth.authServerUrl = authServerUrl;
  }

  return oauth;
}

export function prepareLocalServer(
  fields: ServerFormFields,
  serverId: string
): Result<LocalServer> {
  const name = fields.name.trim();
  if (!name) {
    return { success: false, error: "Name is required" };
  }

  const command = fields.command.trim();
  if (!command) {
    return { success: false, error: "Command is required" };
  }

  const envResult = parseEnvInput(fields.env.trim());
  if (!envResult.success) {
    return { success: false, error: envResult.error || "Invalid environment variables" };
  }
  const normalizedEnv = normalizeEnv(envResult.data);

  const localServer: LocalServer = {
    id: serverId,
    name,
    command,
    args: parseArgs(fields.args),
    ...(normalizedEnv && Object.keys(normalizedEnv).length > 0 ? { env: normalizedEnv } : {}),
  };

  return { success: true, data: localServer };
}

export function prepareLocalServerUpdates(fields: ServerFormFields): Result<Partial<LocalServer>> {
  const name = fields.name.trim();
  if (!name) {
    return { success: false, error: "Name is required" };
  }

  const command = fields.command.trim();
  if (!command) {
    return { success: false, error: "Command is required" };
  }

  const envResult = parseEnvInput(fields.env.trim());
  if (!envResult.success) {
    return { success: false, error: envResult.error || "Invalid environment variables" };
  }
  const normalizedEnv = normalizeEnv(envResult.data);

  const updates: Partial<LocalServer> = {
    name,
    command,
    args: parseArgs(fields.args),
  };

  updates.env = normalizedEnv && Object.keys(normalizedEnv).length > 0 ? normalizedEnv : undefined;

  return { success: true, data: updates };
}

export function prepareRemoteServer(
  fields: ServerFormFields,
  serverId: string
): Result<RemoteServer> {
  const name = fields.name.trim();
  if (!name) {
    return { success: false, error: "Name is required" };
  }

  const url = fields.url.trim();
  if (!url) {
    return { success: false, error: "URL is required" };
  }

  if (!fields.serverType || fields.serverType === "stdio") {
    return { success: false, error: "Transport type is required" };
  }

  const bearerToken = resolveBearerToken(fields.token);
  const oauth = buildOAuthConfig(fields, false);

  const remoteServer: RemoteServer = {
    id: serverId,
    name,
    url,
    type: fields.serverType,
    ...(bearerToken ? { bearerToken } : {}),
    ...(oauth ? { oauth } : {}),
  };

  return { success: true, data: remoteServer };
}

export function prepareRemoteServerUpdates(
  fields: ServerFormFields
): Result<Partial<RemoteServer>> {
  const name = fields.name.trim();
  if (!name) {
    return { success: false, error: "Name is required" };
  }

  const url = fields.url.trim();
  if (!url) {
    return { success: false, error: "URL is required" };
  }

  if (!fields.serverType || fields.serverType === "stdio") {
    return { success: false, error: "Transport type is required" };
  }

  const updates: Partial<RemoteServer> = {
    name,
    url,
    type: fields.serverType,
  };

  const bearerToken = resolveBearerToken(fields.token);
  if (bearerToken !== undefined) {
    updates.bearerToken = bearerToken;
  } else if (!fields.token.trim()) {
    updates.bearerToken = undefined;
  }

  updates.oauth = buildOAuthConfig(fields, true);

  return { success: true, data: updates };
}
