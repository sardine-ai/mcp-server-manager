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

Ensure no other process is using the callback port (default: 8888).

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
