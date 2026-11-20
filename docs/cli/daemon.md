# Daemon

Commands for running the MCP gateway as a background service.

The **daemon** is the core of MCP Server Manager. It runs a **gateway server** that:

1. Manages all your configured MCP servers
2. Provides a single proxy endpoint at `localhost:{port}/mcp`
3. Routes requests from connected clients to your servers

## How the Daemon and Gateway Work Together

```
┌──────────────────────────────────────────────┐
│          Your MCP Servers                    │
│  (filesystem, github, database, etc.)        │
└──────────────┬───────────────────────────────┘
               │
         ┌─────▼─────────┐
         │  mcpsm Daemon │
         │  (Gateway)    │
         └─────┬─────────┘
               │
      ┌────────┼────────┐
      │        │        │
   ┌──▼──┐  ┌─▼──┐  ┌──▼───┐
   │Claude│ │Cursor│ │ Windsurf│
   └──────┘  └──────┘  └────────┘
```

When you connect clients, they communicate with the daemon's gateway server. The daemon manages all your servers and proxies requests between clients and servers.

---

## daemon start

Start the gateway daemon.

```bash
mcpsm daemon start [servers...] [options]
```

### Options

| Option             | Description                           |
| ------------------ | ------------------------------------- |
| `--profile <name>` | Start servers from a specific profile |
| `--foreground`     | Run in foreground (not as daemon)     |

### Examples

```bash
# Start all enabled servers
mcpsm daemon start

# Start specific servers
mcpsm daemon start filesystem github

# Start with a profile
mcpsm daemon start --profile work

# Run in foreground (useful for debugging)
mcpsm daemon start --foreground
```

### What Happens

1. Selected servers are spawned
2. Gateway server starts on configured port (default: 8850)
3. Gateway listens on `localhost:{port}/mcp`
4. Process runs in background
5. PID is saved for later management
6. Connected clients can now access all running servers through the gateway

---

## daemon stop

Stop the running daemon.

```bash
mcpsm daemon stop
```

This gracefully shuts down:

- All running MCP server processes
- The gateway HTTP server

---

## daemon refresh

Refresh the running daemon configuration without restarting it.

```bash
mcpsm daemon refresh
```

Use this after editing servers or tool filters to push changes to the running gateway.

---

## daemon status

Show daemon status.

```bash
mcpsm daemon status
```

### Output

```
Gateway Status: RUNNING

  PID: 12345
  Port: 8850
  Uptime: 2h 15m

  Running Servers:
    ● filesystem    11 tools
    ● github        8 tools
```

Or if not running:

```
Gateway Status: STOPPED
```

---

## daemon logs

View or manage daemon logs.

```bash
mcpsm daemon logs [options]
```

### Options

| Option            | Description                        |
| ----------------- | ---------------------------------- |
| `-f, --follow`    | Follow log output (like `tail -f`) |
| `-n, --lines <n>` | Show last n lines (default: 50)    |
| `--clear`         | Clear log file                     |

### Examples

```bash
# View last 50 lines
mcpsm daemon logs

# View last 100 lines
mcpsm daemon logs -n 100

# Follow logs in real-time
mcpsm daemon logs -f

# Clear logs
mcpsm daemon logs --clear
```

### Log Location

Logs are stored in `~/.mcp-manager/daemon.log`

---

## daemon startup

Manage auto-start on system boot.

```bash
mcpsm daemon startup <enable|disable|status>
```

### Enable Auto-Start

```bash
mcpsm daemon startup enable
```

This creates:

- **macOS**: LaunchAgent plist in `~/Library/LaunchAgents/`
- **Linux**: Systemd user service in `~/.config/systemd/user/`
- **Windows**: Startup shortcut

### Disable Auto-Start

```bash
mcpsm daemon startup disable
```

### Check Status

```bash
mcpsm daemon startup status
```

---

## Example: Production Setup

```bash
# Configure daemon
mcpsm settings set port 8080

# Create a production profile
mcpsm profile create production
mcpsm profile add production filesystem
mcpsm profile add production api-server

# Start with profile
mcpsm daemon start --profile production

# Enable auto-start
mcpsm daemon startup enable

# Verify
mcpsm daemon status
mcpsm daemon startup status
```

---

## Troubleshooting

### Daemon Won't Start

```bash
# Check logs
mcpsm daemon logs -n 100

# Try foreground mode
mcpsm daemon start --foreground
```

### Port Already in Use

```bash
# Change port
mcpsm port 9000

# Restart daemon
mcpsm daemon stop
mcpsm daemon start
```

When you change the port, all connected clients are automatically updated with the new port.

### Check Process Manually

```bash
# macOS/Linux
ps aux | grep mcpsm

# Check port (default 8850)
lsof -i :8850
```

---

## Daemon and Client Connections

When you connect clients using `mcpsm clients connect`, each client gets a gateway server entry that points to the daemon's gateway:

```json
{
  "mcpsm": {
    "command": "mcpsm",
    "args": ["bridge", "http://localhost:{port}/mcp"]
  }
}
```

Keep the daemon running so clients can reach all your servers through the gateway.

## bridge

Stdio bridge that clients start; you do not run it yourself. It forwards MCP messages to the gateway and passes the folder it was started in, so local servers run in the client's project. See [Project Folders](/guide/architecture#project-folders).

```bash
mcpsm bridge <url> [--cwd <dir>]
```

- `<url>` - Gateway endpoint, such as `http://localhost:8850/mcp` or `http://localhost:8850/mcp/<profile>`
- `--cwd <dir>` - Project folder, for clients that do not start servers in it (Cursor passes `${workspaceFolder}`). Ignored if it is not an existing absolute folder.
