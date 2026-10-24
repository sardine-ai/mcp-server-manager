# Import & Export

Commands for migrating server configurations.

## import

Import servers from a file or existing client.

```bash
mcpsm import <source> [options]
```

### Import from File

```bash
mcpsm import ./backup.json
```

### Import from Client

```bash
mcpsm import --from <client>
```

Supported clients: `claude`, `cursor`, `windsurf`, `kiro`, `zed`, `antigravity`

### Conflict Handling

If incoming servers conflict with existing ones, you can:

- Provide a global strategy flag: `--overwrite`, `--skip`, or `--merge`
- Or choose per-server interactively (default). You will be prompted to `[s] skip`, `[o] overwrite`, or `[m] merge` each conflict.

Examples:

```bash
# Interactive per-conflict prompts
mcpsm import servers.json

# Overwrite all conflicts automatically
mcpsm import servers.json --overwrite

# Merge incoming fields with existing
mcpsm import servers.json --merge
```

### Examples

```bash
# Import from Claude Desktop
mcpsm import --from claude

# Import from Cursor
mcpsm import --from cursor

# Import from Kiro
mcpsm import --from kiro

# Import from Zed
mcpsm import --from zed

# Import from Google Antigravity
mcpsm import --from antigravity

# Import from JSON file
mcpsm import ./my-servers.json
```

### Import Behavior

- When no strategy is provided, you are prompted per conflict
- Server IDs are regenerated on import
- Tool filters are reset (run `mcpsm test` to re-discover tools)

---

### Partial failures

Result counts include only successful additions, updates, and merges. Rejected operations are listed by server ID, remaining servers are still processed, and the command returns a nonzero exit status. Successful imports remain saved; the batch is not rolled back.

## export

Export servers to stdout or file.

```bash
mcpsm export [options]
```

### Options

| Option                | Description                      |
| --------------------- | -------------------------------- |
| `-o, --output <file>` | Write to file instead of stdout  |
| `--format <format>`   | Export format: `mcpsm` or `json` |

### Formats

| Format  | Description                                        |
| ------- | -------------------------------------------------- |
| `mcpsm` | Native format, includes tool filters and metadata  |
| `json`  | MCP standard JSON (servers + remoteServers arrays) |

### Examples

```bash
# Export to stdout (MCPSM format)
mcpsm export

# Export to file
mcpsm export -o backup.json

# Pipe to clipboard (macOS)
mcpsm export | pbcopy
```

### MCPSM Format

```json
{
  "version": "2.2.2",
  "exported": "2024-01-15T10:30:00Z",
  "servers": [
    {
      "name": "filesystem",
      "type": "stdio",
      "command": "npx",
      "args": "-y @modelcontextprotocol/server-filesystem /home/user"
    }
  ],
  "remoteServers": [
    {
      "name": "my-api",
      "type": "http",
      "url": "https://api.example.com/mcp"
    }
  ]
}
```

## Backup & Restore

### Create Backup

```bash
mcpsm export -o ~/mcp-backup-$(date +%Y%m%d).json
```

### Restore from Backup

```bash
mcpsm import ~/mcp-backup-20240115.json
```

### Migrate Between Machines

1. On the source machine:

   ```bash
   mcpsm export -o servers.json
   ```

2. Transfer `servers.json` to the new machine

3. On the target machine:
   ```bash
   mcpsm import servers.json
   mcpsm test
   mcpsm clients sync
   ```
