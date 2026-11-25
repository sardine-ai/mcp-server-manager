# Server Management

Commands for managing MCP servers.

## list

List all configured servers.

```bash
mcpsm list [options]
```

### Options

| Option     | Description                |
| ---------- | -------------------------- |
| `--json`   | Output in JSON format      |
| `--tokens` | Show per-tool token counts |

### Examples

```bash
# List all servers
mcpsm list

# JSON output for scripting
mcpsm list --json

# Show token usage
mcpsm list --tokens
```

### Output

```
Local Servers (STDIO):
  ● filesystem    ✔ 11 tools · 4.2k tokens
  ● github        ✔ 8 tools · 3.1k tokens
  ○ postgres      ? unknown

Remote Servers (HTTP/SSE):
  ● my-api [HTTP] ✔ 5 tools · 5.2k tokens
```

---

## add

Add a new MCP server.

```bash
mcpsm add <name> --type <stdio|http|sse> [options]
```

### Options

| Option                | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `--type <type>`       | Server type: `stdio`, `http`, or `sse` (required)                   |
| `--command <cmd>`     | Command to run (stdio only)                                         |
| `--args <args>`       | Command arguments (stdio only, space/comma separated, quotes group) |
| `--env <env...>`      | Env vars for stdio servers (`KEY=VAL`, space/comma)                 |
| `--url <url>`         | Server URL (http/sse only)                                          |
| `--token <token>`     | Bearer token for auth (http/sse only)                               |
| `--oauth`             | Enable OAuth for http/sse servers                                   |
| `--client-id <id>`    | OAuth client ID (remote only)                                       |
| `--client-secret <s>` | OAuth client secret (remote only)                                   |
| `--scopes <scopes>`   | OAuth scopes, comma-separated (remote only)                         |
| `--auth-server <url>` | OAuth authorization server URL (remote only)                        |
| `--test`              | Test the server immediately after adding                            |

### Examples

```bash
# Add local stdio server (filesystem)
mcpsm add filesystem -t stdio -c "npx" -a "-y @modelcontextprotocol/server-filesystem /tmp" --test

# Add local stdio server with PAT
mcpsm add github -t stdio -c "npx" -a "-y @modelcontextprotocol/server-github" -e "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx"

# Add remote HTTP server with OAuth
mcpsm add asana -t http -u "https://asana.example.com/mcp" --oauth --scopes "tasks:read" --auth-server "https://auth.asana.com"
mcpsm auth login asana

# Add SSE server with bearer token
mcpsm add stream-api -t sse -u "https://api.example.com/mcp/sse" --token "mytoken"
```

Arguments are passed to the server exactly as stored. Quotes group a value that contains spaces, and nothing inside them is expanded, so `-a '--note "$(whoami)"'` sends the literal text `$(whoami)`.

Servers added before arguments were passed literally may have stored fragments like `["--dir", "\"/tmp/my", "projects\""]`. Re-run `mcpsm edit <server> --args '--dir "/tmp/my projects"'` to fix those.

---

## remove

Remove a server. Aliases: `rm`, `delete`

```bash
mcpsm remove <name|id> [options]
```

### Options

| Option      | Description              |
| ----------- | ------------------------ |
| `-y, --yes` | Skip confirmation prompt |

### Examples

```bash
# Remove with confirmation
mcpsm remove filesystem

# Remove without confirmation
mcpsm remove filesystem -y

# Remove by ID
mcpsm rm abc123 -y
```

---

## edit

Edit an existing server's configuration.

```bash
mcpsm edit <name|id> [options]
```

### Options

| Option            | Description                       |
| ----------------- | --------------------------------- |
| `--name <name>`   | Change server name                |
| `--type <type>`   | Change remote type (`http`/`sse`) |
| `--url <url>`     | Change URL (remote only)          |
| `--token <token>` | Change bearer token (remote only) |
| `--oauth`         | Enable OAuth (remote only)        |
| `--no-oauth`      | Disable OAuth (remote only)       |
| `--client-id`     | OAuth client ID (remote only)     |
| `--client-secret` | OAuth client secret (remote only) |
| `--scopes`        | OAuth scopes (remote only)        |
| `--auth-server`   | OAuth auth server URL (remote)    |
| `--command <cmd>` | Change command (local only)       |
| `--args <args>`   | Change arguments (local only)     |

### Examples

```bash
# Change server name
mcpsm edit filesystem --name fs-server

# Update remote URL
mcpsm edit my-api --url "https://new-api.example.com/mcp"

# Update command args
mcpsm edit filesystem --args "-y @modelcontextprotocol/server-filesystem /new/path"
```

---

## enable / disable

Enable or disable a server without deleting it.

```bash
mcpsm enable <name|id>
mcpsm disable <name|id> [--yes]
```

### Examples

```bash
# Disable a server
mcpsm disable filesystem

# Disable non-interactively (CI)
mcpsm disable api --yes

# Re-enable
mcpsm enable api
```

---

## test

Test server connectivity and discover tools.

```bash
mcpsm test [name|id]
```

### Examples

```bash
# Test all servers
mcpsm test

# Test specific server
mcpsm test filesystem
```

### Output

```
Testing filesystem... ✔ OK (11 tools)
Testing github... ✔ OK (8 tools)
Testing postgres... ✘ Failed (connection refused)
```
