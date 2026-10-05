# Configuration

MCP Server Manager stores configuration in two main locations:

1. **mcpsm configuration** (`~/.mcp-manager/`) - Your server definitions and settings
2. **Client configurations** - Where each client stores the gateway server entry

## mcpsm Configuration Files

All mcpsm settings are stored in `~/.mcp-manager/`:

| File                | Description                               |
| ------------------- | ----------------------------------------- |
| `config.json`       | Server configurations (local and remote)  |
| `tool-filters.json` | Per-server tool enable/disable settings   |
| `settings.json`     | Application settings (port, editor, etc.) |
| `profiles.json`     | Server profiles (grouping by context)     |
| `clients.json`      | Client connection state cache             |

On macOS and Linux, mcpsm creates `~/.mcp-manager/` with private directory
permissions (`0700`) and writes mcpsm-owned JSON files with private file
permissions (`0600`). Existing files with broader permissions are tightened
when mcpsm loads or saves them.

`config.json` can contain secrets such as local server environment variables,
remote bearer tokens, custom headers, and OAuth client secrets. OAuth runtime
tokens are stored separately in `~/.mcp-manager/oauth-tokens.json` with the same
private file permissions.

## config.json

Main configuration file containing server definitions:

```json
{
  "port": 8080,
  "servers": [
    {
      "id": "abc123",
      "name": "filesystem",
      "command": "npx",
      "args": "-y @modelcontextprotocol/server-filesystem /home/user",
      "enabled": true
    }
  ],
  "remoteServers": [
    {
      "id": "def456",
      "name": "my-api",
      "type": "http",
      "url": "https://api.example.com/mcp",
      "enabled": true
    }
  ]
}
```

## tool-filters.json

Controls which tools are enabled per server:

```json
{
  "abc123": {
    "allTools": ["read_file", "write_file", "list_directory"],
    "enabled": ["read_file", "list_directory"],
    "totalTokens": 4200
  }
}
```

## settings.json

Application-wide settings:

```json
{
  "port": 8850,
  "editor": "code"
}
```

### Available Settings

| Setting  | Type   | Default | Description                                     |
| -------- | ------ | ------- | ----------------------------------------------- |
| `port`   | number | `8850`  | Gateway port (updated in all connected clients) |
| `editor` | string | `code`  | Default editor command                          |

### Port Changes

When you change the `port` setting, **all connected clients are automatically updated**:

1. All clients with the mcpsm gateway are detected
2. The gateway is removed and re-added with the new port
3. Changes are written to both primary and real-time config paths
4. For real-time clients (Cursor, Windsurf, VS Code, Zed), changes take effect immediately
5. For other clients, they'll use the new port on next restart

## profiles.json

Server groupings for different contexts:

```json
{
  "work": {
    "name": "work",
    "servers": ["abc123", "def456"]
  },
  "personal": {
    "name": "personal",
    "servers": ["ghi789"]
  }
}
```

## Client Configuration Files

When you connect clients to the gateway, mcpsm adds a gateway server entry to each client's config file. These files are **not** in `~/.mcp-manager/` - they're in each client's native location.

### Configuration Locations

#### macOS

```
Claude Desktop:    ~/Library/Application Support/Claude/claude_desktop_config.json
Cursor:           ~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         ~/Library/Application Support/Windsurf/User/globalStorage/windsurf.mcp/config.json
VS Code:          ~/Library/Application Support/Code/User/mcp.json
Zed:              ~/.config/zed/settings.json
Claude Code:      ~/.claude/claude_code_config.json
Codex:            ~/.codex/config.toml
Gemini:           ~/.gemini/settings.json
```

#### Windows

```
Claude Desktop:    %APPDATA%\Claude\claude_desktop_config.json
Cursor:           %APPDATA%\Cursor\User\globalStorage\cursor.mcp\config.json
Windsurf:         %APPDATA%\Windsurf\User\globalStorage\windsurf.mcp\config.json
VS Code:          %APPDATA%\Code\User\mcp.json
Zed:              %APPDATA%\Zed\settings.json
Claude Code:      %USERPROFILE%\.claude\claude_code_config.json
Codex:            %USERPROFILE%\.codex\config.toml
Gemini:           %USERPROFILE%\.gemini\settings.json
```

#### Linux

```
Claude Desktop:    ~/.config/Claude/claude_desktop_config.json
Cursor:           ~/.config/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         ~/.config/Windsurf/User/globalStorage/windsurf.mcp/config.json
VS Code:          ~/.config/Code/User/mcp.json
Zed:              ~/.config/zed/settings.json
Claude Code:      ~/.claude/claude_code_config.json
Codex:            ~/.codex/config.toml
Gemini:           ~/.gemini/settings.json
```

### Real-Time Config Paths

For clients that support real-time config loading, mcpsm also writes to additional paths:

```
Cursor:   ~/.cursor/mcp.json
Windsurf: ~/.codeium/windsurf/mcp_config.json
VS Code:  ~/Library/Application Support/Code/User/mcp.json
Zed:      Uses its primary settings.json path (no separate real-time path)
```

When you connect a client, mcpsm writes the gateway server to **both** locations. This ensures:

- The primary config is always persisted
- Real-time clients see changes immediately without restart
- All clients have a consistent configuration

### What Gets Added to Client Configs

When you connect a client, mcpsm adds this gateway server entry:

```json
{
  "mcpsm": {
    "command": "npx",
    "args": ["-y", "supergateway", "--streamableHttp", "http://localhost:PORT/mcp"]
  }
}
```

Where `PORT` is your current gateway port (default: 8850).

For Zed, mcpsm writes a `context_servers.mcpsm` entry that points to `http://localhost:PORT/mcp`.

All your configured servers are accessible through this single gateway. Other servers in the client's config are preserved and remain unchanged.

## Edit mcpsm Configuration

Open the mcpsm config in your default editor:

```bash
mcpsm config
```

Show mcpsm config file path:

```bash
mcpsm config --path
```

Show mcpsm config directory:

```bash
mcpsm config --dir
```

## Edit Client Configuration

To view or edit a client's configuration file:

```bash
mcpsm clients open claude
mcpsm clients open cursor
```

This opens the client's primary config file in your editor. You can see the gateway server entry and any other servers.
