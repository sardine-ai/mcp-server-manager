<div align="center">

# MCP Server Manager

**The all-in-one CLI tool to manage your MCP servers across all clients**

[![npm version](https://img.shields.io/npm/v/mcp-server-manager?color=blue)](https://www.npmjs.com/package/mcp-server-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js->=18-green)](https://nodejs.org)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/sardine-ai/mcp-server-manager)

**[🌐 Website & Documentation](https://sardine-ai.github.io/mcp-server-manager)**

</div>

---

## The Problem

Managing MCP servers across multiple AI clients (Claude Desktop, Cursor, Windsurf, VS Code, Zed) is fragmented and tedious:

- 🔧 **Scattered configs** - Each client has its own config file in different locations
- 🔄 **Manual sync** - Adding a server means manually editing multiple JSON files
- 👁️ **No visibility** - Hard to know which servers are working or failing
- 🧪 **No testing** - Can't easily verify servers before using them in your workflow

This friction slows down development and makes server management error-prone.

## The Solution

**MCP Server Manager** is a unified CLI + TUI tool that centralizes MCP server management with a single gateway pattern. Add servers once, connect your clients, and everything stays in sync automatically.

**Key Features:**

- 🎯 **Gateway Pattern** - One gateway, all clients
- 🎨 **Interactive TUI** - Beautiful terminal UI with keyboard shortcuts and customizable themes
- ⚡ **Automatic Sync** - Changes propagate to all clients instantly
- 🧪 **Built-in Testing** - Verify servers before using them
- 📊 **Token Tracking** - Monitor context usage per server
- 📦 **Profile Management** - Group servers for different contexts with cloning support
- 🎨 **Theme Customization** - Choose from three color palettes (default, minimal, colorful)

---

## Installation

### NPM

```bash
npm install -g mcp-server-manager
```

### Bash (curl)

```bash
curl -fsSL https://raw.githubusercontent.com/sardine-ai/mcp-server-manager/main/scripts/install.sh | bash
```

### PowerShell

```powershell
irm https://raw.githubusercontent.com/sardine-ai/mcp-server-manager/main/scripts/install.ps1 | iex
```

---

## Quick Start

### Launch the TUI

```bash
mcpsm
```

### Or use CLI commands

```bash
# List all servers
mcpsm list

# Add a server
mcpsm add myserver --type stdio --command "npx" --args "-y @modelcontextprotocol/server-filesystem /tmp"

# Test all servers
mcpsm test

# Connect a client
mcpsm clients connect claude
```

For complete command reference and guides, see the **[documentation](https://sardine-ai.github.io/mcp-server-manager/guide/getting-started.html)**.

---

## Contributing

Contributions are welcome! Please see our [contributing guidelines](https://github.com/sardine-ai/mcp-server-manager/blob/main/CONTRIBUTING.md) for details.

---

## License

MIT © [Sardine AI](https://github.com/sardine-ai)
