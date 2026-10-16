# Client Connection

Commands for managing MCP client connections using the gateway pattern.

## Supported Clients

| Client             | ID            | Platform              | Real-time Loading |
| ------------------ | ------------- | --------------------- | ----------------- |
| Claude Desktop     | `claude`      | macOS, Windows        | No                |
| Cursor             | `cursor`      | macOS, Windows, Linux | Yes               |
| Windsurf           | `windsurf`    | macOS, Windows, Linux | Yes               |
| Kiro               | `kiro`        | macOS, Windows, Linux | Yes               |
| VS Code            | `vscode`      | macOS, Windows, Linux | Yes               |
| Zed                | `zed`         | macOS, Windows, Linux | Yes               |
| Claude Code        | `claude-code` | CLI                   | No                |
| Codex              | `codex`       | macOS, Windows, Linux | No                |
| Gemini             | `gemini`      | macOS, Windows, Linux | No                |
| Google Antigravity | `antigravity` | macOS, Windows, Linux | No                |

---

## Global or Current Folder

Interactive `mcpsm clients connect <client>` asks where to configure clients that support project settings. In the TUI Clients screen, press **S** to switch between Global and Current folder before connecting. The displayed status and config path belong to the selected scope.

Use `--scope project` to configure the current working directory explicitly, or `--scope global` to skip the prompt. Non-interactive commands default to global.

```bash
mcpsm clients connect cursor --scope project
mcpsm clients connect codex --scope project --profile dev
mcpsm clients list --scope project
mcpsm clients open cursor --scope project
mcpsm clients disconnect cursor --scope project
```

Project files are created relative to the directory where you run mcpsm. Run from the folder opened by your client, usually the project root. Global configs are not changed, and existing project settings and other servers are preserved. JSON comments and formatting are not retained when saving.

| Client | Project config |
| --- | --- |
| [Cursor](https://docs.cursor.com/context/model-context-protocol) | `.cursor/mcp.json` |
| [Kiro](https://kiro.dev/docs/mcp/configuration/) | `.kiro/settings/mcp.json` |
| [VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers) | `.vscode/mcp.json` |
| [Claude Code](https://code.claude.com/docs/en/mcp) | `.mcp.json` |
| [Codex](https://developers.openai.com/codex/config-basic/) | `.codex/config.toml` |
| [Gemini](https://geminicli.com/docs/get-started/configuration/) | `.gemini/settings.json` |
| [Zed](https://github.com/zed-industries/zed/blob/main/crates/settings_content/src/project.rs) | `.zed/settings.json` |
| [OpenCode](https://opencode.ai/docs/config/) | `opencode.json` (existing `opencode.jsonc` is also supported) |
| [Antigravity](https://www.antigravity.google/docs/mcp) | `.agents/mcp_config.json` |

Claude Desktop and Windsurf remain global only and are excluded from the project list. Clients may require approval or project trust before loading local MCP configuration. Codex requires a trusted project; Claude Code asks to approve project MCP servers.

The scope controls the client gateway entry. MCPSM profiles, servers, and daemon settings still use the existing manager configuration. If the daemon port changes, reconnect each project's clients to update their local entries.

---

## Gateway Pattern

MCP Server Manager uses a **gateway pattern** for client connections:

- A single `mcpsm` server is added to each connected client's configuration
- This server points to `localhost:{port}/mcp` (via `supergateway` or direct URL, depending on the client)
- All your configured servers are accessible through this single gateway
- When the port is changed, all connected clients are automatically updated

---

## clients

List detected MCP clients and their connection status.

```bash
mcpsm clients
```

### Output

```
Detected MCP Clients:

  1. Claude Desktop     ✔ Installed   Connected
  2. Cursor            ✔ Installed   Disconnected
  3. Windsurf          ✘ Not installed
  4. VS Code           ✔ Installed   Connected
  5. Zed               ✔ Installed   Disconnected
  6. Claude Code       ✘ Not installed
```

**Status Legend:**

- `✔ Connected` - Client has mcpsm gateway server configured
- `Disconnected` - Client is installed but not connected
- `✘ Not installed` - Client application not found

---

## clients connect

Connect a client by adding the mcpsm gateway server to its configuration.

```bash
mcpsm clients connect <client>
```

### Examples

```bash
# Connect Claude Desktop
mcpsm clients connect claude

# Connect Cursor
mcpsm clients connect cursor

# Connect multiple clients
mcpsm clients connect cursor
mcpsm clients connect windsurf
```

### What Happens

1. The `mcpsm` gateway server is added to the client's config
2. The server proxies requests to the daemon at `localhost:{port}/mcp`
3. All your configured servers become accessible in that client
4. For real-time loading clients, changes appear without restart

---

## clients disconnect

Disconnect a client by removing the mcpsm gateway server from its configuration.

```bash
mcpsm clients disconnect <client>
```

### Example

```bash
# Disconnect Cursor
mcpsm clients disconnect cursor
```

### What Happens

- The `mcpsm` gateway server is removed from the client's config
- The client will no longer have access to your MCP servers
- Other servers in the client's config are preserved

---

## clients open

Open a client's config file in your default editor.

```bash
mcpsm clients open <client>
```

### Examples

```bash
# Open Claude Desktop config
mcpsm clients open claude

# Open Cursor config
mcpsm clients open cursor
```

---

## Workflow Example

### 1. Add your MCP servers

```bash
mcpsm add myserver
mcpsm add anotherserver
```

### 2. Connect your clients

```bash
mcpsm clients connect claude
mcpsm clients connect cursor
mcpsm clients connect windsurf
```

### 3. Use servers in clients

All your servers are now available in Claude Desktop, Cursor, Windsurf, and Zed through the `mcpsm` gateway.

### 4. Change port if needed

```bash
mcpsm port 9000
```

All connected clients are automatically updated with the new port!

### 5. Disconnect when done

```bash
mcpsm clients disconnect cursor
```

---

## Port Changes

When you change the gateway port:

```bash
# In Settings
mcpsm settings set port 9000

# Or directly
mcpsm port 9000
```

**Automatic Updates:**

- All connected clients are automatically reconnected
- The new port is written to each client's configuration
- No manual editing required
- Real-time loading clients (Cursor, Windsurf, VS Code, Zed) see changes without restart
