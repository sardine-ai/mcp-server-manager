# Settings

Commands for managing application settings.

## settings

List all settings and their current values.

```bash
mcpsm settings
```

### Output

```
Settings:

  port            8850          Gateway port number
  editor          vi            Default editor command
  allowedOrigins                Browser origins allowed to call the gateway
```

---

## settings get

Get a specific setting value.

```bash
mcpsm settings get <key>
```

### Example

```bash
mcpsm settings get port
# Output: 8080
```

---

## settings set

Set a setting value.

```bash
mcpsm settings set <key> <value>
```

### Examples

```bash
# Change gateway port
mcpsm settings set port 9000

# Set default editor
mcpsm settings set editor vim
```

---

## settings reset

Reset all settings to defaults.

```bash
mcpsm settings reset
```

### Default Values

| Setting          | Default                    |
| ---------------- | -------------------------- |
| `port`           | `8850`                     |
| `editor`         | `$EDITOR` or `vi`          |
| `allowedOrigins` | empty (no browser origins) |

---

## Available Settings

### port

Gateway HTTP port number. Port edits and settings reset update existing global and registered project gateways and refresh the running daemon. A failed client config produces a warning while the saved port change proceeds; repair the reported path and repeat the port command to retry.

```bash
mcpsm settings set port 8080
```

- Type: `number`
- Range: `1024-65535`
- Default: `8850`

### editor

Command to open config files.

```bash
mcpsm settings set editor "code -w"
```

- Type: `string`
- Default: `$EDITOR` environment variable, or `vi`

### allowedOrigins

Browser origins (`scheme://host[:port]`, comma-separated) allowed to call the gateway. The gateway rejects any request that has an `Origin` header not on this list, so web pages cannot call your tools. MCP clients that are not browsers (Claude Code, Codex, Cursor, OpenCode, Antigravity, `mcpsm bridge`, Kiro, Zed) send no `Origin` and need no entry. Add one only for a browser-based client, such as MCP Inspector in direct mode:

```bash
mcpsm settings set allowedOrigins http://localhost:6274
```

- Type: `string`
- Default: empty

---

## Settings in TUI

Press `G` in the main menu to open Settings:

```
Settings:

  → port: 8850 (default)
    editor: vi

  Enter/Space: edit or toggle · R: reset all · ESC: back
```
