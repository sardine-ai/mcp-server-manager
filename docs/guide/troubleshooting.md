# Troubleshooting

Common issues and solutions when using MCP Server Manager.

## Installation Issues

### `command not found: mcpsm`

The CLI is not in your PATH. Try one of these solutions:

```bash
# Option 1: Use npx
npx mcp-server-manager

# Option 2: Reinstall globally
npm install -g mcp-server-manager

# Option 3: Check npm global bin path
npm config get prefix
# Add the bin folder to your PATH
```

### Permission denied during installation

```bash
# On macOS/Linux, use sudo (not recommended) or fix npm permissions
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
# Add the export line to your shell profile (.bashrc, .zshrc, etc.)
```

## Server Issues

### Server won't start / fails to connect

1. **Check if the server command exists:**

   ```bash
   which npx  # or your server command
   ```

2. **Test the server manually:**

   ```bash
   mcpsm test <server-name>
   ```

3. **Check server logs:**

   ```bash
   mcpsm logs -f
   ```

4. **Verify server configuration:**
   ```bash
   mcpsm list --json
   ```

### "Server timeout" error

The server is taking too long to respond. This can happen if:

- The server binary needs to be downloaded (first run with npx)
- The server is processing a large request
- Network issues with remote servers

**Solution:** Increase the timeout in settings:

```bash
mcpsm settings set testTimeout 60000  # 60 seconds
```

### "Port already in use" error

Another process is using the gateway port.

```bash
# Check what's using the port
lsof -i :8850

# Change the port
mcpsm port 9000

# Or kill the existing process
mcpsm stop
```

## Client Sync Issues

### Client not detected

MCP Server Manager auto-detects clients based on config file locations. If a client isn't detected:

1. **Check if the client is installed and has been run at least once**
2. **Verify the config path exists:**

| Client         | Config Location                                       |
| -------------- | ----------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/` (macOS)       |
| Claude Desktop | `%APPDATA%\Claude\` (Windows)                         |
| Cursor         | `~/.cursor/`                                          |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                 |
| VS Code        | `~/.vscode/` or `~/Library/Application Support/Code/` |
| Zed            | `~/.config/zed/`                                      |
| Claude Code    | `~/.claude/`                                          |
| Codex          | `~/.codex/`                                           |
| Gemini CLI     | `~/.gemini/`                                          |

### Sync not working

```bash
# Check client status
mcpsm clients

# Enable the client first
mcpsm clients enable <client-name>

# Then sync
mcpsm clients sync
```

### Changes not reflected in client

Most clients require a restart to pick up config changes:

1. Close the client application completely
2. Run `mcpsm clients sync`
3. Reopen the client

## Daemon Issues

### Daemon won't start

```bash
# Check status
mcpsm status

# View logs for errors
mcpsm logs

# Try stopping first, then starting
mcpsm stop
mcpsm start
```

### Auto-start not working

**macOS (launchd):**

```bash
# Check if launch agent is loaded
launchctl list | grep mcp

# Reload the launch agent
mcpsm startup disable
mcpsm startup enable
```

**Linux (systemd):**

```bash
# Check service status
systemctl --user status mcpsm

# Reload and restart
systemctl --user daemon-reload
mcpsm startup enable
```

**Windows:**

```bash
# Check Task Scheduler
# Open Task Scheduler and look for "MCP Server Manager"
```

## Tool Discovery Issues

### Tools not showing up

```bash
# Force rediscovery
mcpsm tools discover

# Test the specific server
mcpsm test <server-name>
```

### Tool filtering not working

```bash
# List current tool filters
mcpsm tools list

# Reset tool filters for a server
mcpsm tools enable <server-name> --all
```

## OAuth / Authentication Issues

### OAuth flow fails

1. **Check your network connection**
2. **Verify the authorization URL is correct**
3. **Make sure the callback port (default 8851) is not blocked**

```bash
# Check if callback port is available
lsof -i :8851
```

### Token expired

```bash
# Re-authenticate
mcpsm auth login <server-name>
```

## Performance Issues

### Slow startup

- First run with npx servers can be slow (downloading packages)
- Many servers starting simultaneously can be slow

**Solution:** Use native installations instead of npx:

```bash
# Instead of npx, install globally
npm install -g @modelcontextprotocol/server-filesystem

# Update server config to use direct command
mcpsm edit filesystem --command "mcp-server-filesystem"
```

### High memory usage

Too many servers running simultaneously.

**Solution:** Use profiles to manage server groups:

```bash
# Create a minimal profile
mcpsm profile create minimal
mcpsm profile add minimal essential-server

# Switch to it
mcpsm profile use minimal
```

## Getting More Help

### Run the doctor command

```bash
mcpsm doctor
```

This checks:

- Node.js version
- npm availability
- Config file validity
- Server connectivity
- Port availability

### Enable debug logging

```bash
DEBUG=mcpsm* mcpsm <command>
```

### Report an Issue

If you can't resolve the issue:

1. Run `mcpsm doctor` and copy the output
2. Check the [GitHub Issues](https://github.com/sardine-ai/mcp-server-manager/issues)
3. Open a new issue with:
   - Your OS and version
   - Node.js version (`node --version`)
   - mcpsm version (`mcpsm version`)
   - The error message and steps to reproduce
