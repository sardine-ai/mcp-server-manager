# Client Connections

This guide explains how to connect MCP clients to MCP Server Manager using the gateway pattern.

## Overview

MCP Server Manager uses a **gateway pattern** where a single `mcpsm` gateway server is added to each client. This gateway server proxies all MCP requests to the mcpsm daemon, giving you access to all configured servers.

## Quick Connection

### Connect a Client

**Via TUI:**

1. Launch `mcpsm`
2. Press `C` to go to Clients screen
3. Navigate to your client with arrow keys
4. Press `ENTER` to connect

**Via CLI:**

```bash
mcpsm clients connect claude
mcpsm clients connect cursor
mcpsm clients connect windsurf
mcpsm clients connect kiro
```

### Disconnect a Client

**Via TUI:**

1. Go to Clients screen (press `C`)
2. Navigate to your client
3. Press `ENTER` to disconnect

**Via CLI:**

```bash
mcpsm clients disconnect cursor
```

## How It Works

When you connect a client:

1. **Single Gateway Server**: A `mcpsm` server entry is added to your client's configuration
2. **Gateway Connection**: The `mcpsm` entry points to `localhost:{port}/mcp` (via `mcpsm bridge`, or a direct URL for Kiro and Zed)
3. **All Servers Available**: All your configured servers become accessible through this gateway
4. **Existing Servers Preserved**: Any servers you already had configured remain untouched

### Example: Connecting Cursor

When you run `mcpsm clients connect cursor`, mcpsm:

1. Detects Cursor is installed
2. Reads the current Cursor config
3. Preserves any existing servers
4. Adds:
   ```json
   {
     "mcpsm": {
       "url": "http://localhost:8850/mcp"
     }
   }
   ```
5. Writes to both:
   - Primary config: `~/.config/Cursor/User/globalStorage/cursor.mcp/config.json`
   - Real-time config: `~/.cursor/mcp.json` (for instant updates)

Now all your servers are available in Cursor through the mcpsm gateway.

## Connection States

Each client has a connection state:

### Connected ✔

- Client has the mcpsm gateway server
- All your servers are accessible
- Change port once, it updates automatically
- For real-time clients, changes appear immediately

### Disconnected

- Client is installed but not connected to mcpsm
- You see your other servers, but not mcpsm servers
- Press `ENTER` to connect

### Not Installed ✘

- Client application not found on system
- Cannot connect until you install the client

## Real-Time vs Restart-Required

Some clients support **real-time config loading** - they pick up changes instantly without restart:

| Client             | Real-Time | Behavior                          |
| ------------------ | --------- | --------------------------------- |
| Cursor             | ✓ Yes     | Changes appear immediately        |
| Windsurf           | ✓ Yes     | Changes appear immediately        |
| Kiro               | ✓ Yes     | Changes appear immediately        |
| VS Code            | ✓ Yes     | Changes appear immediately        |
| Zed                | ✓ Yes     | Changes appear immediately        |
| Claude Desktop     | No        | Requires restart after connection |
| Codex              | No        | Requires restart after connection |
| Gemini             | No        | Requires restart after connection |
| Google Antigravity | No        | Requires restart after connection |

### Real-Time Config Paths

mcpsm writes to special config paths for clients that support real-time loading:

```
Cursor:   ~/.cursor/mcp.json
Windsurf: ~/.codeium/windsurf/mcp_config.json
Kiro:     ~/.kiro/settings/mcp.json
VS Code:  ~/Library/Application Support/Code/User/mcp.json
Zed:      Uses its primary settings.json path (no separate real-time path)
```

When you connect a real-time client, mcpsm writes to **both** the primary config and the real-time path, ensuring instant updates.

## Workflow Example

### Step 1: Add Your Servers

```bash
mcpsm add filesystem --type stdio --command "npx" --args "-y @modelcontextprotocol/server-filesystem"
mcpsm add github --type http --url "https://api.github.com/mcp"
```

### Step 2: Connect Your Clients

```bash
# Connect multiple clients
mcpsm clients connect claude
mcpsm clients connect cursor
mcpsm clients connect windsurf
mcpsm clients connect kiro
```

### Step 3: Use in Clients

All servers are now available in each connected client:

- **Claude Desktop**: Restart and check MCP servers
- **Cursor**: Changes appear immediately
- **Windsurf**: Changes appear immediately
- **Kiro**: Changes appear immediately
- **Zed**: Changes appear immediately

### Step 4: Change Port (Optional)

The gateway runs on port 8850 by default. To change it:

```bash
mcpsm port 9000
```

Existing global and registered project gateways are updated with the new port. Missing or inaccessible configs produce warnings; fix the reported path and repeat the port command to retry.

## Configuration Details

### What Gets Added

When you connect a client, mcpsm adds this to the client's MCP server config:

```json
{
  "mcpsm": {
    "command": "/path/to/node",
    "args": ["/path/to/mcp-server-manager/bin/cli.js", "bridge", "http://localhost:PORT/mcp"]
  }
}
```

The `PORT` matches your current gateway port setting (default: 8850).

For Zed, mcpsm adds a `context_servers.mcpsm` entry that points to `http://localhost:PORT/mcp`.

### What Stays Intact

When you connect or disconnect a client, all other servers in the config remain unchanged. mcpsm only modifies the `mcpsm` gateway entry.

### Config File Locations

#### macOS

```
Claude Desktop:    ~/Library/Application Support/Claude/claude_desktop_config.json
Cursor:           ~/Library/Application Support/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         ~/Library/Application Support/Windsurf/User/globalStorage/windsurf.mcp/config.json
Kiro:             ~/.kiro/settings/mcp.json
VS Code:          ~/Library/Application Support/Code/User/mcp.json
Zed:              ~/.config/zed/settings.json
Google Antigravity: ~/.gemini/config/mcp_config.json
```

#### Windows

```
Claude Desktop:    %APPDATA%\Claude\claude_desktop_config.json
Cursor:           %APPDATA%\Cursor\User\globalStorage\cursor.mcp\config.json
Windsurf:         %APPDATA%\Windsurf\User\globalStorage\windsurf.mcp\config.json
Kiro:             %USERPROFILE%\.kiro\settings\mcp.json
VS Code:          %APPDATA%\Code\User\mcp.json
Zed:              %APPDATA%\Zed\settings.json
Google Antigravity: %USERPROFILE%\.gemini\config\mcp_config.json
```

#### Linux

```
Claude Desktop:    ~/.config/Claude/claude_desktop_config.json
Cursor:           ~/.config/Cursor/User/globalStorage/cursor.mcp/config.json
Windsurf:         ~/.config/Windsurf/User/globalStorage/windsurf.mcp/config.json
Kiro:             ~/.kiro/settings/mcp.json
VS Code:          ~/.config/Code/User/mcp.json
Zed:              ~/.config/zed/settings.json
Google Antigravity: ~/.gemini/config/mcp_config.json
```

## View Client Status

**Via TUI:**
Press `C` to see all clients with their connection status and whether they're installed.

**Via CLI:**

```bash
mcpsm clients
```

Output:

```
Detected MCP Clients:

  1. Claude Desktop     ✔ Installed   Connected
  2. Cursor            ✔ Installed   Connected
  3. Windsurf          ✔ Installed   Disconnected
  4. VS Code           ✘ Not installed
  5. Zed               ✔ Installed   Disconnected
```

## Open Client Config

You can open a client's config file in your editor to review what was added.

**Via TUI:**

1. Go to Clients screen (press `C`)
2. Navigate to a client
3. Press `O` to open in editor

**Via CLI:**

```bash
mcpsm clients open cursor
```

This opens the client's primary config file (not the real-time path). You can see the mcpsm gateway entry alongside any other servers.

## Troubleshooting Connection

### "Client not installed"

The client application wasn't found on your system. Install it first, then try connecting again.

### "Failed to write config"

Check that:

1. The client is not currently running and locking the config file
2. You have write permissions to the config directory
3. The directory exists (mcpsm creates it if needed)

Try again after closing the client.

### Changes Not Appearing

**For real-time clients** (Cursor, Windsurf, VS Code, Zed):

- Changes should appear immediately
- If not, try restarting the client
- Check that the real-time config path is writable

**For other clients** (Claude Desktop, Codex, Gemini):

- Restart the client to pick up changes
- Confirm the primary config file was updated

### Daemon Not Running

If clients can't connect to the gateway:

1. Check that mcpsm daemon is running
2. Verify the port matches what's in your client config
3. Test with `mcpsm doctor`

## Advanced: Manual Configuration

If you prefer to edit the config manually:

1. Find your client's config file (see paths above)
2. Add the mcpsm gateway server:
   ```json
   {
     "mcpsm": {
       "command": "mcpsm",
       "args": ["bridge", "http://localhost:8850/mcp"]
     }
   }
   ```
3. Adjust the port if needed (default is 8850)
4. Save and restart the client

## Port Changes and Client Updates

When you change the gateway port in Settings:

```bash
mcpsm port 9000
```

The system:

1. Saves the port in daemon config and settings
2. Updates existing global gateways and registered project gateways
3. Refreshes the running daemon on the new port
4. Reports warnings for config files that could not be updated

**The port change proceeds even when some config files cannot be updated.** Their registrations are retained for retry. Reconnect older project configs once to register them; MCPSM does not scan project folders.

Example output:

```
✓ Port set to 9000
```

## Daemon Relationship

The clients connect through a **gateway server** running in the mcpsm daemon:

```
Your Client (Claude, Cursor, etc.)
        ↓ (via mcpsm gateway server in config)
mcpsm bridge (forwards stdio requests and the project folder)
        ↓ (to localhost:PORT/mcp)
mcpsm Daemon
        ↓ (proxies to actual servers)
Your Servers (filesystem, github, etc.)
```

The daemon manages all your servers and the clients connect to them through this single gateway. This is why you only need to add servers once - they're automatically available everywhere.

## Next Steps

- [Architecture](/guide/architecture) - Deep dive into how the system works
- [Configuration](/guide/configuration) - Manage config files
- [Troubleshooting](/guide/troubleshooting) - Common issues
- [Getting Started](/guide/getting-started) - Back to overview
