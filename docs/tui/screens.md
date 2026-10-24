# TUI Screens

Reference for all screens in the interactive TUI.

## Clients

**Shortcut:** `C`

Manage MCP client connections using the gateway pattern.

```
MCP Clients:

  → Claude Desktop     ✔ Installed   Connected
    Cursor            ✔ Installed   Disconnected
    Windsurf          ✘ Not installed
    VS Code           ✔ Installed   Connected
    Zed               ✔ Installed   Disconnected
    Claude Code       ✘ Not installed

  ↑↓: Navigate  |  SPACE: Toggle Connect/Disconnect  |  S: Global/Current folder  |  O: Open Config  |  R: Refresh  |  ESC: Back
```

### Features

- View all detected MCP clients
- See installation status (✔ Installed, ✘ Not installed)
- See connection status (Connected, Disconnected)
- Connect clients to add mcpsm gateway server
- Disconnect clients to remove gateway server
- Open client config files for manual editing
- Real-time status updates
- Switch global/current folder with `S`; status, connect/disconnect, and Open Config use the selected scope

### Gateway Pattern

When you connect a client:

- A single `mcpsm` server is added to the client's config
- This server proxies requests to `localhost:{port}/mcp`
- All your configured servers become accessible in that client
- Port changes update existing global gateways and registered project gateways; failed paths are reported as warnings

### Actions

| Key     | Action                       |
| ------- | ---------------------------- |
| `↑/↓`   | Navigate between clients     |
| `SPACE` | Toggle connect/disconnect    |
| `S`     | Switch global/current folder |
| `O`     | Open client config in editor |
| `R`     | Refresh detection            |
| `ESC`   | Return to main menu          |

### Status Meanings

- **Connected** - Client has mcpsm gateway server; can access all your servers
- **Disconnected** - Client is installed but not connected to mcpsm
- **Not installed** - Client application not found on system

---

## Profiles

**Shortcut:** `F`

Manage server profiles.

```
Profiles:

  1. work (active)     3 servers
  2. personal          2 servers
  3. project-x         5 servers
     (no profile)      all servers

  1-3: Switch  |  N: New  |  R: Rename  |  D: Delete  |  ESC: Back
```

### Features

- View all profiles
- See active profile
- View server count per profile
- Add new profiles (with option to clone)
- Clone profiles with all settings
- Rename profiles
- Delete profiles
- Switch between profiles

### Actions

| Key     | Action                              |
| ------- | ----------------------------------- |
| `↑/↓`   | Navigate profiles                   |
| `Enter` | Switch to profile                   |
| `A`     | Add new profile (with clone option) |
| `R`     | Rename profile                      |
| `D`     | Delete profile                      |
| `ESC`   | Return to main menu                 |

**Adding/Cloning:** When you press `A`, you'll be prompted to either clone from an existing profile or create an empty one. Cloning copies all servers, remote servers, and tool filter settings from the source profile.

---

## Import/Export

**Shortcut:** `I`

Import and export server configurations. Import results count successful operations and list failures by server ID. A partial import is shown as unsuccessful while keeping successful changes.

```
Import / Export:

  Import:
    1. Import from Claude Desktop
    2. Import from Cursor
    3. Import from JSON file

  Export:
    4. Export to JSON (MCPSM format)
    5. Export to JSON (Claude format)
    6. Preview export

  1-6: Select  |  ESC: Back
```

### Features

- Import from existing MCP clients
- Import from backup files
- Export in native or Claude format
- Preview export before saving

### Actions

| Key   | Action                     |
| ----- | -------------------------- |
| `1`   | Import from Claude Desktop |
| `2`   | Import from Cursor         |
| `3`   | Import from JSON file      |
| `4`   | Export to JSON (MCPSM)     |
| `5`   | Export to JSON (Claude)    |
| `6`   | Preview export             |
| `ESC` | Return to main menu        |

---

## Settings

**Shortcut:** `G`

Configure application settings.

```
Settings:

  → port: 8850 (default)
    editor: vi

  ↑↓: Navigate  |  ENTER: Edit  |  SPACE: Toggle (bool)  |  C: Show config path | O: Open config | R: Reset All  |  ESC: Back
```

### Features

- View all application settings
- Edit individual settings by pressing ENTER
- Reset to defaults
- **Automatic port updates:** When port is changed, global and registered project gateways are updated; failed paths are shown as warnings

### Settings

| Setting | Type   | Description                                  |
| ------- | ------ | -------------------------------------------- |
| Port    | Number | Gateway port (updates all connected clients) |
| Editor  | String | Default editor command                       |

### Actions

| Key     | Action                |
| ------- | --------------------- |
| `↑/↓`   | Navigate settings     |
| `ENTER` | Edit selected setting |
| `SPACE` | Toggle boolean        |
| `C`     | Show config file path |
| `O`     | Open config in editor |
| `R`     | Reset all to defaults |
| `ESC`   | Return to main menu   |

### Important: Port Changes

When you change the port setting:

- ✓ All connected clients are **updated when their config is accessible**
- ✓ The new port is written to each client's configuration
- ✓ Existing bare and profile gateways are updated; disconnected profiles remain disconnected
- ✓ A running daemon is refreshed and its new listener is checked
- Failures report the saved port and affected targets; successful changes remain saved
- ✓ Real-time loading clients (Cursor, Windsurf, VS Code, Zed) see changes without restart

---

## Tool Filters

**Shortcut:** `T` (from main menu)

Configure which tools are enabled per server.

```
Tools for deepwiki:

  [x] ask_question        Ask anything about the wiki    108 tokens
  [x] read_wiki_structure Get available pages             90 tokens
  [x] read_wiki_contents  Read a specific page            86 tokens

  Enabled: 3/3 tools  |  Total: 284 tokens

  ↑↓: Navigate  |  SPACE: Toggle  |  A: All  |  N: None  |  X: Discover  |  G: Global tokens  |  ESC: Save
```

### Features

- View all available tools per server
- See tool descriptions and per-tool token counts
- Get the server's total token usage directly in the footer
- Global token dashboard across all servers
- Enable/disable individual tools
- Bulk enable/disable
- Badges for read-only, destructive and idempotent tools (from the server's annotations)
- "All read-only" and "All destructive" rows at the top of the list: move up to them and press `SPACE` to check or uncheck every tool in the group

### Actions

| Key       | Action                   |
| --------- | ------------------------ |
| `↑` / `↓` | Navigate tools           |
| `SPACE`   | Toggle tool or group     |
| `A`       | Enable all tools         |
| `N`       | Disable all tools        |
| `X`       | Discover/retest tools    |
| `G`       | Toggle global token view |
| `ESC`     | Save and return          |

---

## Add Server

**Shortcut:** `A` (from main menu)

Interactive prompts to add a new server.

```
Add New Server:

  Server name: my-server█

  Type: (use arrows)
    > stdio    Local process (command)
      http     Remote HTTP server
      sse      Remote SSE server

  Command: npx█
  Arguments: -y @modelcontextprotocol/server-example█
```

### Flow

1. Enter server name
2. Select server type
3. Enter command (STDIO) or URL (HTTP/SSE)
4. Enter arguments or token (optional)
5. (Remote) Configure OAuth client if needed
6. Confirm

---

## Auth

**Shortcut:** `O` (from main menu)

Manage OAuth authentication for remote servers.

```
OAuth Management:

  → Remote One (token expired)
    Remote Two (not authenticated)

  Enter: Authenticate  |  R: Revoke  |  A: Login all  |  ESC: Back
```

### Features

- View auth status for all OAuth-enabled remote servers
- Start OAuth login for selected server
- Show login success only after the connection test passes; otherwise show the test error
- Automatically refresh expiring tokens when a refresh token is available
- Revoke tokens per server
- Login all OAuth-enabled servers in sequence

### Actions

| Key     | Action                 |
| ------- | ---------------------- |
| `Enter` | Authenticate selected  |
| `R`     | Revoke token           |
| `A`     | Login all needing auth |
| `ESC`   | Back to main menu      |

---

## Daemon

**Shortcut:** `Enter` (from main menu)

Manage the background gateway daemon.

```
Daemon Management:

  Status: ● Running (PID: 1234) | Port: 8850 | Auto-start: disabled

  → Start Daemon
    Refresh Daemon
    Stop Daemon
    View Logs
    Clear Logs
    Enable Auto-start
    Disable Auto-start

  Enter: Select  |  ESC: Back
```

### Features

- Start/stop daemon (uses the current selection and tool filters)
- Refresh daemon after config changes
- View or clear logs
- Toggle auto-start

### Actions

| Key     | Action                |
| ------- | --------------------- |
| `↑/↓`   | Navigate menu options |
| `Enter` | Run selected action   |
| `ESC`   | Return to main menu   |

---

## Screen Flow

```
                    ┌─────────────┐
                    │  Main Menu  │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
     ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
     │  Clients  │   │ Profiles  │   │  Settings │
     │    (C)    │   │    (F)    │   │    (G/P)  │
     └───────────┘   └───────────┘   └───────────┘
           │               │               │
     ┌─────▼──────┐        │         ┌─────▼──────┐
     │  Import/   │        │         │ Tool Filters │
     │  Export(I) │        │         │     (T)      │
     └────────────┘        │         └──────────────┘
           │               │
     ┌─────▼──────┐   ┌────▼─────┐
     │   Daemon   │   │   Auth   │
     │   (Enter)  │   │    (O)   │
     └────────────┘   └──────────┘
```
