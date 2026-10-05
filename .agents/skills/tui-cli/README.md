# TUI + CLI Parity & Documentation Manager

This skill automatically maintains TUI/CLI parity and keeps all project documentation in sync with code changes.

## Quick Start

When you've modified CLI or TUI code:

```bash
cd /Users/matex/Projects/mcp-server-manager
python3 .claude/skills/tui-cli/scripts/generate_checklist.py
```

The script will:

1. Detect all changed files
2. Extract new/modified CLI commands
3. **Automatically update documentation files**
4. Generate a parity checklist for manual verification

## How It Works

### Three Phases

#### 1. Detection

Analyzes git diff to find modified files in:

- `src/cli/commands/*.cmd.ts` - CLI implementations
- `src/tui/screens/*.screen.ts` - TUI screens
- `src/services/*.service.ts` - Shared business logic
- `src/shared/features.ts` - Feature registry

#### 2. Documentation Auto-Update

Automatically updates these files:

- **`docs/cli/<category>.md`** - Command documentation
- **`docs/tui/screens.md`** - TUI screen descriptions
- **`docs/tui/shortcuts.md`** - Keyboard shortcuts
- **`CLAUDE.md`** - Quick command reference (CLI Commands section)
- **`README.md`** - Feature highlights (if applicable)

#### 3. Parity Checklist

Generates checklist items for:

- Documentation completeness
- Feature registry alignment
- CLI/TUI consistency
- Test coverage

## File Structure

```
.claude/skills/tui-cli/
├── SKILL.md                      # Full skill documentation
├── README.md                      # This file
└── scripts/
    └── generate_checklist.py      # Main analysis & update script
```

## What Gets Updated Automatically

### When you modify `src/cli/commands/*.cmd.ts`:

✅ Extracts:

- Command name, aliases, description
- All options with flags and descriptions
- Help text and usage patterns

✅ Updates:

- `docs/cli/<category>.md` with new command sections
- `CLAUDE.md` quick reference with new commands
- Command signature and options

### When you modify `src/tui/screens/*.screen.ts`:

✅ Updates:

- `docs/tui/screens.md` with new screen descriptions
- `docs/tui/shortcuts.md` with keyboard shortcuts
- `docs/tui/overview.md` with navigation updates

### When you modify `src/services/*.service.ts`:

📋 Notes in checklist:

- Which features are affected
- Which CLI/TUI commands use this service
- Recommendation to verify both interfaces

## Documentation Format Reference

### CLI Commands (`docs/cli/*.md`)

```markdown
## command-name

One-line description of what the command does.

### Usage

\`\`\`bash
mcpsm command-name [args] [options]
\`\`\`

### Options

| Option        | Description                   |
| ------------- | ----------------------------- |
| `[arg]`       | Optional argument description |
| `--flag`      | Flag description              |
| `-s, --short` | Short and long flag forms     |

### Examples

\`\`\`bash

# Example 1

mcpsm command-name --flag

# Example 2 with args

mcpsm command-name arg-value
\`\`\`

### Output

\`\`\`
Sample terminal output here
\`\`\`

---
```

### CLAUDE.md Quick Reference

```
## CLI Commands

mcpsm list [--json]              List all servers
mcpsm add [name]                 Add a new server
mcpsm remove <server> [-y]       Remove a server
mcpsm test [server]              Test server(s)
```

## Preservation Rules

The skill **always preserves**:

- Existing commands (never removes them)
- Custom examples and explanations
- Markdown formatting and structure
- Manual documentation notes

The skill **always updates**:

- Command signatures and options
- Quick reference sections
- Status of completed vs incomplete features
- Cross-references between docs

## Integration with Workflow

### Before Creating a PR:

1. Make your CLI/TUI changes
2. Run the skill: `python3 .claude/skills/tui-cli/scripts/generate_checklist.py`
3. Documentation updates automatically
4. Review the checklist items
5. Verify in your IDE that all files look correct
6. Commit changes including doc updates

### In Your Commit Message:

Include documentation updates:

```
feat: add gateway daemon control commands

- Implement daemon start/stop/status commands
- Add daemon logs viewer
- Update CLI documentation
- Update TUI daemon screen
```

## Manual Verification Checklist

After running the script, manually verify:

- [ ] Command options are correctly extracted
- [ ] Markdown formatting is correct
- [ ] Examples match your implementation
- [ ] Cross-references work (links between docs)
- [ ] Quick reference in CLAUDE.md is accurate
- [ ] No duplicate commands in documentation
- [ ] README highlights updated (if major feature)

## Troubleshooting

### Documentation didn't update?

Check if file was actually modified:

```bash
git diff src/cli/commands/
```

### Formatting looks wrong?

The script maintains existing format. If markdown is broken:

1. Check source TypeScript file for syntax errors
2. Verify the `.description()` and `.option()` calls are valid
3. Run `npm run lint:fix` to auto-format
4. Re-run the script

### Missing commands?

The script extracts from `.command()` calls. Ensure:

- Commands are registered with the main program object
- Using standard `.command()`, `.description()`, `.option()` syntax
- Not conditionally registering commands

## Python Script Details

**File:** `scripts/generate_checklist.py`

Main functions:

- `get_git_diff()` - Gets changed files
- `categorize_files()` - Groups by feature type
- `extract_cli_commands()` - Parses TypeScript commands
- `update_docs()` - Updates markdown files
- `generate_checklist()` - Creates parity items

Run with verbose output:

```bash
python3 .claude/skills/tui-cli/scripts/generate_checklist.py -v
```

## Tips & Best Practices

1. **Keep descriptions consistent** - Use active voice ("Test the server" not "Tests the server")

2. **Use consistent terminology** - "Enable/disable", "Add/remove", "List/show"

3. **Examples should be real** - Copy examples from your actual testing

4. **One command per file section** - Don't mix multiple commands in one markdown section

5. **Link between docs** - Reference related commands: "See also: `mcpsm test`"

6. **Keep README simple** - Only highlight top-level, user-facing commands

7. **Update CLAUDE.md carefully** - It's the quick reference, so keep it concise

## When to Use This Skill

- ✅ Adding new CLI commands
- ✅ Modifying command options
- ✅ Adding new TUI screens
- ✅ Changing keyboard shortcuts
- ✅ Refactoring services (use checklist to verify both interfaces)
- ❌ Don't use for code-only changes without CLI/TUI impact
- ❌ Don't use for tests-only changes (unless adding new features)

## Future Enhancements

Possible improvements:

- [ ] Automatic example generation from test cases
- [ ] Cross-reference validation (links in docs)
- [ ] Screenshot detection for TUI screens
- [ ] Comparison with git history to detect breaking changes
- [ ] Automatic changelog generation

---

**Last Updated:** November 2024
**Compatible with:** MCP Server Manager v2.0+
