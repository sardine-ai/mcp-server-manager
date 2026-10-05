# Utilities

Miscellaneous utility commands.

## tokens

Show MCP token usage summary.

```bash
mcpsm tokens [options]
```

### Options

| Option           | Description             |
| ---------------- | ----------------------- |
| `-d, --detailed` | Show per-tool breakdown |
| `--json`         | Output in JSON format   |

### Examples

```bash
# Summary view
mcpsm tokens

# Detailed breakdown
mcpsm tokens --detailed

# JSON output
mcpsm tokens --json
```

### Summary Output

```
Token Usage:

  filesystem     4,200 tokens   11 tools
  github         3,100 tokens   8 tools
  my-api         5,200 tokens   5 tools
  ─────────────────────────────────────
  Total         12,500 tokens   24 tools
```

### Detailed Output

```
Token Usage (Detailed):

filesystem (4,200 tokens):
  read_file           380 tokens
  write_file          420 tokens
  list_directory      350 tokens
  ...

github (3,100 tokens):
  create_issue        450 tokens
  list_repos          380 tokens
  ...
```

---

## doctor

Run health checks on your system.

```bash
mcpsm doctor
```

### Output

```
System Health Check:

  ✔ Node.js        v20.10.0
  ✔ npm            v10.2.3
  ✔ npx            available
  ✔ uv             v0.1.24
  ✔ Python         v3.11.6

  All checks passed!
```

Or with issues:

```
System Health Check:

  ✔ Node.js        v20.10.0
  ✔ npm            v10.2.3
  ✔ npx            available
  ✘ uv             not found
  ✔ Python         v3.11.6

  1 issue found.

  To install uv:
    curl -LsSf https://astral.sh/uv/install.sh | sh
```

---

## config

Open configuration file in editor.

```bash
mcpsm config [options]
```

### Options

| Option   | Description                |
| -------- | -------------------------- |
| `--path` | Show config file path      |
| `--dir`  | Show config directory path |

### Examples

```bash
# Open config in editor
mcpsm config

# Show config file path
mcpsm config --path
# Output: /home/user/.mcp-manager/config.json

# Show config directory
mcpsm config --dir
# Output: /home/user/.mcp-manager
```

---

## version

Show version information.

```bash
mcpsm version [--json]
# or mcpsm -v / --version
```

### Output

```bash
mcpsm version
# MCP Server Manager v2.2.2

mcpsm version --json
# {"version":"2.2.2"}
```

---

## help

Show help information.

```bash
mcpsm help
# or
mcpsm -h
# or
mcpsm --help
```

### Output

```
MCP Server Manager - Manage MCP servers across AI clients

Usage:
  mcpsm                    Launch interactive TUI
  mcpsm <command> [args]   Run CLI command

Commands:
  list                     List all servers
  add [name]               Add a server
  remove <name>            Remove a server
  test [name]              Test server(s)
  ...

Options:
  -h, --help               Show help
  -v, --version            Show version

Examples:
  mcpsm                    Launch TUI
  mcpsm list               List servers
  mcpsm add --type stdio   Add local server
  mcpsm clients sync       Sync to clients

Documentation:
  https://sardine-ai.github.io/mcp-server-manager/docs/
```

---

## Common Workflows

### Daily Usage

```bash
# Start your day
mcpsm                     # Launch TUI
# or
mcpsm daemon start        # Start daemon in background
```

### Debugging

```bash
# Check system health
mcpsm doctor

# View daemon logs
mcpsm logs -f

# Test specific server
mcpsm test filesystem
```

### Maintenance

```bash
# Backup config
mcpsm export -o backup.json

# Check token usage
mcpsm tokens --detailed

# Clear logs
mcpsm logs --clear
```
