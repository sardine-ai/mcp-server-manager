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

| Setting  | Default           |
| -------- | ----------------- |
| `port`   | `8850`            |
| `editor` | `$EDITOR` or `vi` |

---

## Available Settings

### port

Gateway HTTP port number, stored in `config.json`. Reads and updates match `mcpsm port` and TUI settings.

Port updates rewrite existing global and registered project client gateways and refresh a running daemon. Failures return a nonzero exit status and report the saved port; successful updates are retained. Reset applies the same workflow with port 8850.

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

---

## Settings in TUI

Press `G` in the main menu to open Settings:

```
Settings:

  → port: 8850 (default)
    editor: vi

  Enter/Space: edit or toggle · R: reset all · ESC: back
```
