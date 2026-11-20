# Architecture

This guide explains the architecture of MCP Server Manager and how the gateway pattern works.

## System Overview

MCP Server Manager uses a **gateway pattern** to manage multiple MCP servers across different AI clients:

```
┌─────────────────────────────────────────────────────────┐
│                    Your Servers                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ Filesystem   │  │   Database   │  │   APIs       │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────────┘
                            ▲
                            │ TCP/stdio
                            │
                    ┌───────────────────┐
                    │   mcpsm Daemon    │
                    │  (Gateway Server) │
                    └───────────────────┘
                            ▲
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────────────┐   ┌──────────────┐   ┌─────────────┐
   │   Claude   │   │    Cursor    │   │  Windsurf   │
   │  Desktop   │   │              │   │             │
   └────────────┘   └──────────────┘   └─────────────┘
```

## Core Concepts

### Gateway Pattern

Instead of syncing individual servers to each client, mcpsm operates as a **gateway server**:

1. **Daemon**: Runs a central `mcpsm` server that listens on `localhost:{port}/mcp`
2. **Client Connection**: Each client connects to the daemon through a single `mcpsm` server entry
3. **Gateway**: The `mcpsm` server points to the daemon (via `mcpsm bridge`, or a direct URL for Kiro and Zed)
4. **All Servers Accessible**: All configured servers are accessible through this single gateway

### Benefits

- **Single Point of Configuration**: Add a server once, it's available in all connected clients
- **No Individual Sync**: Clients don't need individual server copies
- **Easy Port Changes**: Changing the port automatically updates all connected clients
- **Real-time Loading**: Supported clients see changes without restart
- **Scalability**: Adding new clients is as simple as running a connect command

## 3-State Connection Model

Each MCP client has three possible states:

| State         | Meaning                                      | How to Reach It                     |
| ------------- | -------------------------------------------- | ----------------------------------- |
| Connected     | Client has mcpsm gateway; can access servers | `mcpsm clients connect <client>`    |
| Disconnected  | Client installed but not connected to mcpsm  | `mcpsm clients disconnect <client>` |
| Not Installed | Client application not found on system       | Install the client                  |

### State Transitions

```
┌───────────────┐
│ Not Installed │
└───────────────┘
       │
       │ (user installs client)
       ▼
┌───────────────┐     mcpsm clients      ┌───────────────┐
│ Disconnected  │ ────────────────────→  │   Connected   │
│               │ ←──────────────────────│               │
│               │  mcpsm clients disconnect              │
└───────────────┘                        └───────────────┘
```

## Client Service

The `ClientService` (src/services/client.service.ts) manages client detection and connections.

### Client Detection

When you run `mcpsm clients`, the service:

1. Checks for each supported client application
2. Detects the config file location (OS-specific paths)
3. Reads the config to check if mcpsm gateway is already connected
4. Returns the status for each client

### Client Paths

Config files are stored in platform-specific locations:

#### macOS

```
Claude Desktop:    ~/Library/Application Support/Claude/claude_desktop_config.json
Cursor:           ~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         ~/Library/Application Support/Windsurf/User/globalStorage/windsurf.mcp/config.json
VS Code:          ~/Library/Application Support/Code/User/mcp.json
Zed:              ~/.config/zed/settings.json
Claude Code:      ~/.claude/claude_code_config.json
Codex CLI:        ~/.codex/config.toml
Gemini CLI:       ~/.gemini/settings.json
```

#### Windows

```
Claude Desktop:    %APPDATA%/Claude/claude_desktop_config.json
Cursor:           %APPDATA%/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         %APPDATA%/Windsurf/User/globalStorage/windsurf.mcp/config.json
VS Code:          %APPDATA%/Code/User/mcp.json
Zed:              %APPDATA%/Zed/settings.json
Claude Code:      %USERPROFILE%/.claude/claude_code_config.json
Codex CLI:        %USERPROFILE%/.codex/config.toml
Gemini CLI:       %USERPROFILE%/.gemini/settings.json
```

#### Linux

```
Claude Desktop:    ~/.config/Claude/claude_desktop_config.json
Cursor:           ~/.config/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         ~/.config/Windsurf/User/globalStorage/windsurf.mcp/config.json
VS Code:          ~/.config/Code/User/mcp.json
Zed:              ~/.config/zed/settings.json
Claude Code:      ~/.claude/claude_code_config.json
Codex CLI:        ~/.codex/config.toml
Gemini CLI:       ~/.gemini/settings.json
```

### Real-time Config Paths

Some clients support real-time config loading (no restart required). These use additional config paths:

| Client   | Real-time Path                                   |
| -------- | ------------------------------------------------ |
| Cursor   | ~/.cursor/mcp.json                               |
| Windsurf | ~/.codeium/windsurf/mcp_config.json              |
| VS Code  | ~/Library/Application Support/Code/User/mcp.json |
| Zed      | Uses its primary settings.json path              |

When connecting a client, mcpsm writes to **both** the primary config path and the real-time path (if supported).

## Connection Process

When you run `mcpsm clients connect <client>`:

1. **Check Installation**: Verify the client application exists
2. **Read Current Config**: Load the client's current MCP configuration
3. **Preserve Existing Servers**: Keep all existing servers in the config
4. **Add Gateway Server**: Add the `mcpsm` gateway server entry:
   ```json
   {
     "mcpsm": {
       "command": "/path/to/node",
       "args": ["/path/to/mcp-server-manager/bin/cli.js", "bridge", "http://localhost:PORT/mcp"]
     }
   }
   ```
5. **Write Configs**: Write to both primary and real-time paths
6. **Update Status**: Client moves to "Connected" state

## Disconnection Process

When you run `mcpsm clients disconnect <client>`:

1. **Read Current Config**: Load the client's MCP configuration
2. **Remove Only mcpsm**: Delete only the `mcpsm` gateway server entry
3. **Preserve Existing Servers**: Keep all other servers intact
4. **Write Configs**: Write updated config to both paths
5. **Update Status**: Client moves to "Disconnected" state

## Port Auto-Update

When you change the gateway port in Settings:

1. **Detect Connected Clients**: Find all clients that have the mcpsm gateway
2. **Disconnect All**: Remove the mcpsm gateway from all connected clients
3. **Update Port**: Change the port in settings
4. **Reconnect All**: Add the mcpsm gateway back with the new port
5. **Update All Configs**: Write changes to both primary and real-time paths

This ensures all connected clients automatically update to use the new port without manual intervention.

### Port Change Flow

```
User changes port in Settings
        ↓
Detect all connected clients
        ↓
Disconnect all clients (remove mcpsm gateway)
        ↓
Update port setting
        ↓
Reconnect all clients (add mcpsm gateway with new port)
        ↓
Write to both primary + real-time config paths
        ↓
Show success message with count of updated clients
```

## Daemon and Gateway

The **daemon** is the background process running mcpsm:

- **Gateway Server**: The daemon hosts a gateway server on `localhost:{port}/mcp`
- **All Servers**: The daemon manages and proxies all configured MCP servers
- **Client Proxy**: When a client connects through mcpsm, requests are proxied to the daemon

The **gateway server** in each client configuration is what connects them:

```json
{
  "mcpsm": {
    "command": "/path/to/node",
    "args": ["/path/to/mcp-server-manager/bin/cli.js", "bridge", "http://localhost:PORT/mcp"]
  }
}
```

`mcpsm bridge` forwards all MCP messages to the daemon and passes the folder the client started it in. See [Project Folders](#project-folders).

This runs `mcpsm bridge <url>`. mcpsm writes absolute paths to Node and its CLI script, so GUI clients that do not load your shell profile can start it without `node` or `mcpsm` on their `PATH`.

### Project Folders

Local (STDIO) servers such as Serena, jbcontext, or context-mode read their working directory to find the project. The daemon starts one shared instance of each local server in its own folder, which is the wrong project for every client.

`mcpsm bridge` fixes this:

1. The client starts `mcpsm bridge <url>` in the project it has open (Claude Code, Codex, OpenCode, and Gemini do this; Cursor passes `--cwd ${workspaceFolder}`).
2. The bridge sends that folder to the daemon in the `x-mcpsm-project-dir` header. `/` and your home folder count as "no project".
3. The daemon starts every selected local server in the project folder when the first session for that folder begins. These instances are shared by every session in the folder and stopped when its last session ends. Tool calls to local servers run on them.
4. Remote (HTTP/SSE) servers and sessions without a project keep using the daemon's shared instances.

Until the project's instances have started, the session lists the shared instances' tools, so clients do not wait. Then the daemon sends `notifications/tools/list_changed`, and the session lists the tools the project's instances offer, which can differ: Serena started in a project leaves out `activate_project` and `get_current_config`. Calling a tool from the earlier list that the project's instance lacks returns an error saying so. A call to a local server's tool waits for the project's instances; a call to a remote server's tool does not.

### Request Checks

The gateway listens on `127.0.0.1` only. It also rejects (HTTP 403):

- Requests whose `Host` is not `localhost`, `127.0.0.1`, or `[::1]`, which blocks DNS rebinding.
- Requests with an `Origin` header not in the `allowedOrigins` setting (empty by default), so web pages open in your browser cannot call your tools. MCP clients that are not browsers send no `Origin`.

CORS headers are sent only to allowlisted origins.

## Configuration Files

### Main Configuration

The system stores configuration in `~/.mcp-manager/`:

| File                | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| `config.json`       | Server definitions (local STDIO and remote HTTP/SSE) |
| `settings.json`     | Application settings (port, default editor, etc.)    |
| `profiles.json`     | Server profiles (groupings by project/context)       |
| `tool-filters.json` | Per-server tool enable/disable settings              |
| `clients.json`      | Client connection state cache (informational only)   |

### Client Configurations

Each client maintains its own config file (see Client Paths above). mcpsm reads and writes to these files to manage the gateway server entry.

## Real-Time vs Primary Config

### Primary Config

- The main config file for each client (as listed in Client Paths)
- Always written to when connecting/disconnecting
- Required for all clients

### Real-time Config

- Additional paths for clients that support live config reloading
- Automatically written to when connected
- Allows changes to take effect without restart
- Cursor, Windsurf, VS Code, and Zed support real-time loading

When mcpsm connects a client, it writes the gateway server to **both** locations. This ensures:

- The primary config is always up-to-date
- Clients that support real-time loading see changes immediately
- Clients without real-time support still work (they'll pick up changes on restart)

## Supported Clients

| Client         | ID            | Platforms             | Real-time | Primary Config Path        |
| -------------- | ------------- | --------------------- | --------- | -------------------------- |
| Claude Desktop | `claude`      | macOS, Windows        | No        | claude_desktop_config.json |
| Cursor         | `cursor`      | macOS, Windows, Linux | Yes       | cursor.mcp/config.json     |
| Windsurf       | `windsurf`    | macOS, Windows, Linux | Yes       | windsurf.mcp/config.json   |
| VS Code        | `vscode`      | macOS, Windows, Linux | Yes       | Code/User/mcp.json         |
| Zed            | `zed`         | macOS, Windows, Linux | Yes       | Zed/settings.json          |
| Claude Code    | `claude-code` | CLI                   | No        | claude_code_config.json    |
| Codex          | `codex`       | macOS, Windows, Linux | No        | .codex/config.toml (TOML)  |
| Gemini         | `gemini`      | macOS, Windows, Linux | No        | .gemini/settings.json      |

## Data Flow

### Connecting a Client

```
mcpsm clients connect cursor
        ↓
ClientService.connectClient('cursor')
        ↓
1. Check if Cursor is installed
2. Read ~/.config/Cursor/User/globalStorage/cursor.mcp/config.json
3. Preserve all existing servers
4. Add mcpsm gateway server with current port
5. Write to primary config
6. Write to ~/.cursor/mcp.json (real-time)
        ↓
✓ Connected
```

### Changing Port

```
User: mcpsm port 9000
        ↓
SettingsScreen detects port change
        ↓
1. Find all connected clients (cursor, claude, windsurf, etc.)
2. For each connected client:
   a. disconnectClient(id) - remove mcpsm entry
   b. Disconnect done, port updated
   c. connectClient(id) - add mcpsm entry with new port
   d. Write to both primary + real-time paths
3. Show: "Updated port for 3 clients"
        ↓
All clients now use new port
```

### Client Using Servers

```
User opens Claude Desktop / Cursor / etc.
        ↓
Client loads mcpsm gateway server config
        ↓
mcpsm bridge connects to http://localhost:PORT/mcp
        ↓
User selects a tool from any server
        ↓
Tool request flows: Client → mcpsm bridge → mcpsm daemon → actual server
        ↓
Response flows back through the same path
```

## Implementation Details

### Key Services

**ClientService** (src/services/client.service.ts)

- Detects installed MCP clients
- Manages connections (connect/disconnect)
- Handles config file reading/writing
- Manages both primary and real-time config paths

**ConfigService** (src/services/config.service.ts)

- Manages server definitions
- Stores configuration in `~/.mcp-manager/`

**SettingsService** (src/services/settings.service.ts)

- Manages application settings
- Triggers client reconnection on port changes

**ProfileService** (src/services/profile.service.ts)

- Manages server profiles
- Groups servers by context

### Type Safety

All services are implemented in TypeScript with strict mode enabled. Key types:

- `ClientId` - Union type of supported client IDs
- `ClientStatus` - Union type: 'connected' | 'disconnected' | 'not-installed'
- `DetectedClient` - Client with name, status, and paths
- `ClientMcpConfig` - MCP server configuration structure
- `ServerDefinition` - Local or remote server configuration

## Error Handling

The system handles several error scenarios:

- **Client not installed**: Returns 'not-installed' status
- **Config file missing**: Creates new config with mcpsm gateway
- **File write errors**: Reports error to user, doesn't partially update
- **Port in use**: Caught by daemon, reported to user
- **Invalid config format**: Detects and preserves valid portions

## Threading and Concurrency

- Client operations are synchronous (using `fs` and `spawnSync`)
- Port updates reconnect clients in sequence to ensure consistency
- Settings changes are atomic per client

---

For more information:

- [Getting Started](/guide/getting-started) - Quick overview
- [Client Connections](/guide/client-connections) - Detailed connection guide
- [Configuration](/guide/configuration) - Config file details
- [Troubleshooting](/guide/troubleshooting) - Common issues
