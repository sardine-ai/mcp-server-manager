# Authentication

Commands for managing authentication with remote MCP servers.

## Overview

Remote servers (HTTP/SSE) may require authentication. MCPSM supports:

- **Bearer tokens** - Simple token-based auth
- **OAuth 2.0** - Full OAuth flow with PKCE

---

## auth status

Show authentication status for servers.

```bash
mcpsm auth status [server] [options]
```

### Options

| Option   | Description           |
| -------- | --------------------- |
| `--json` | Output in JSON format |

### Examples

```bash
# Show all servers
mcpsm auth status

# Show specific server
mcpsm auth status my-api

# JSON output
mcpsm auth status --json
```

### Output

```
Authentication Status:

  my-api          ✔ Authenticated (expires: 2024-01-20)
  other-api       ✘ Not authenticated
  secure-server   ✔ Bearer token set
```

---

## auth login

Authenticate with a remote server using OAuth.

```bash
mcpsm auth login <server> [--no-browser]
```

### Notes

- Opens a browser by default; use `--no-browser` to copy the URL manually.
- Requires the server to have OAuth enabled (`mcpsm server update <id> --oauth`).
- OAuth completion and connection verification are reported separately. A completed login can still fail the connection test.

---

## auth logout

Remove OAuth tokens for a server.

```bash
mcpsm auth logout <server> [-f|--force]
```

Prompts for confirmation unless `--force` is provided.

---

## auth login-all

Authenticate with all OAuth-enabled servers.

```bash
mcpsm auth login-all [--no-browser]
```

Skips servers that already have valid tokens.

---

## auth refresh

Refresh the OAuth token for a server (requires a refresh token).

```bash
mcpsm auth refresh <server>
```

---

## Token Storage

OAuth tokens are stored as local JSON in:

- `~/.mcp-manager/oauth-tokens.json`

Each token update reads the latest file and changes only that server's entry.
Refresh results are discarded if the server's credentials changed during the request.
OAuth logs include the server ID, process ID, expiry time, and refresh failure status
and error code, without token values. Daemon logs are in `~/.mcp-manager/logs/gateway.log`.

On macOS and Linux, mcpsm creates the config directory with `0700`
permissions and writes OAuth token files with `0600` permissions. Existing
token files with broader permissions are tightened when mcpsm loads or saves
them.

Older versions used `~/.mcpsm/oauth-tokens.json`. If that legacy file exists
and the new token file is absent, mcpsm copies the tokens into
`~/.mcp-manager/oauth-tokens.json` and leaves the legacy file in place with
private permissions.

---

## Adding Authenticated Servers

### With OAuth

```bash
mcpsm add my-api --type http --url "https://api.example.com/mcp"
mcpsm auth login my-api
```

---

## Troubleshooting

### OAuth Callback Failed

The callback server takes the first free port between `8400` and `8450`, so the redirect URI
normally ends in `/callback` on one of those ports. Make sure nothing else is holding it.

Some providers require the redirect URI to match what you registered with them exactly. Pin the
port so it never moves:

```bash
mcpsm settings set oauthCallbackPort 8400
```

The callback URI is then always `http://127.0.0.1:8400/callback`. If that port is taken, the flow
fails instead of silently using another one.

### Token Expired

```bash
# Re-authenticate
mcpsm auth my-api
```

### Invalid Token

```bash
# Remove and re-set
mcpsm auth revoke my-api
mcpsm auth set my-api "new-token"
```

### Test Connection

```bash
mcpsm test my-api
```

If authentication fails, the test will show:

```
Testing my-api... ✘ Failed (401 Unauthorized)
```
