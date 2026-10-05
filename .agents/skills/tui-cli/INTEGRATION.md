# Skill Integration Guide

How the TUI+CLI skill integrates with your development workflow.

## Workflow Integration

```
┌─────────────────────────────────────────┐
│ 1. Create feature branch                │
│    git checkout -b matt/<feature>       │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│ 2. Implement CLI/TUI changes            │
│    - Edit src/cli/commands/*.cmd.ts     │
│    - Edit src/tui/screens/*.screen.ts   │
│    - Run npm run dev to test            │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│ 3. Run skill to update docs            │
│    python3 .claude/skills/tui-cli/...   │
│    scripts/generate_checklist.py        │
│                                         │
│    ✅ Docs auto-updated                │
│    ✅ Checklist generated              │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│ 4. Verify changes in IDE                │
│    - Check docs/cli/*.md formatting     │
│    - Verify CLAUDE.md quick ref         │
│    - Review README updates              │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│ 5. Run tests & linting                  │
│    npm run lint:fix                     │
│    npm test                             │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│ 6. Commit with doc updates              │
│    git add .                            │
│    git commit -m "feat: ..."            │
│                                         │
│    Include doc changes in commit        │
└──────────────────┬──────────────────────┘
                   ↓
┌─────────────────────────────────────────┐
│ 7. Create PR                            │
│    gh pr create --title "..."           │
│                                         │
│    PR includes:                         │
│    - Code changes (CLI/TUI)             │
│    - Documentation updates              │
│    - Feature registry updates           │
└─────────────────────────────────────────┘
```

## Before Using This Skill

Make sure you have:

- [ ] Completed all code changes (CLI and/or TUI)
- [ ] Code compiles without errors (`npm run build`)
- [ ] Tested your changes manually
- [ ] Created feature branch (`matt/<name>`)

## Running the Skill

### Step 1: Generate Changes

```bash
# Navigate to project root
cd /Users/matex/Projects/mcp-server-manager

# Run the skill
python3 .claude/skills/tui-cli/scripts/generate_checklist.py
```

### Step 2: Expected Output

You'll see something like:

```
🌿 Current branch: matt/new-command

🔍 Detected 3 source file(s) across 1 feature(s)

📚 Documentation Updates:
   ✅ docs/cli/utilities.md - Updated 1 command
   ✅ CLAUDE.md - Updated CLI Commands section

### Modified Files by Feature

**UTILITIES**
  - [CLI] src/cli/commands/utility.cmd.ts

### Parity Checklist

**UTILITIES**
  - [ ] Business logic in `src/services/`
  - [ ] Function exported for CLI + TUI use
  - [x] Command in `src/cli/commands/`
  - [x] Supports `--json` flag if applicable
  - [x] CLI commands documented in `docs/cli/<category>.md`
  - [ ] New options documented with descriptions and examples

[... full checklist ...]
```

### Step 3: Verify Changes

Open each updated file in your IDE:

```bash
# View what changed
git diff docs/cli/
git diff CLAUDE.md
git diff README.md
```

Check for:

- ✅ Correct markdown formatting
- ✅ Command names match implementation
- ✅ Options are accurate
- ✅ No broken syntax

### Step 4: Manual Fixes (if needed)

If documentation looks wrong:

1. **Check the TypeScript source** - Is the `.description()` clear?
2. **Fix the source** - Make description clearer
3. **Re-run the skill** - It will re-extract from updated source
4. **Or edit docs manually** - Make minor tweaks to generated markdown

### Step 5: Run Quality Checks

```bash
# Lint and format
npm run lint:fix
npm run format

# Build and test
npm run build
npm test
```

### Step 6: Commit

```bash
git add .
git commit -m "feat: add new command

- Implement new command in CLI
- Update documentation
- Add parity checklist items"
```

## When to Skip This Skill

❌ **Don't run if you only modified:**

- Tests (unless adding new feature)
- Package.json/package-lock.json (unless dependencies affect docs)
- Other .js files not related to CLI/TUI
- Markdown files manually (unless auto-updating those)

## When to Always Run This Skill

✅ **Always run if you modified:**

- `src/cli/commands/*.cmd.ts` - Any CLI command change
- `src/tui/screens/*.screen.ts` - Any TUI screen change
- `src/tui/index.ts` - Key bindings
- `src/shared/features.ts` - Feature registry

## Troubleshooting

### Issue: "No changes detected"

**Reason:** Git can't find your changes

**Solution:**

```bash
# Make sure you're on a feature branch
git branch

# Check what changed
git diff

# Check git status
git status
```

### Issue: Documentation looks wrong

**Reason:** TypeScript source has unclear descriptions

**Solution:**

1. Edit the source file: `src/cli/commands/file.cmd.ts`
2. Improve `.description()` to be clearer
3. Improve `.option()` descriptions
4. Save the file
5. Re-run the skill

### Issue: Some files didn't update

**Reason:** Feature may not be detected or mapped

**Solution:**

1. Check if file is in correct location: `src/cli/commands/` or `src/tui/`
2. Run skill with verbose: `python3 ... -v`
3. Check category mapping in SKILL.md
4. May need manual update if edge case

### Issue: Formatting broken after update

**Reason:** Markdown syntax issue in extraction

**Solution:**

1. Run `npm run lint:fix`
2. Manually review the markdown
3. Check description text for special chars
4. File issue if it's a consistent problem

## Configuration

### Python Script Location

File: `.claude/skills/tui-cli/scripts/generate_checklist.py`

Key configurations inside:

- File path patterns (where to find CLI commands)
- Documentation paths (where to update)
- Feature categories (grouping logic)
- Extraction patterns (regex for TypeScript parsing)

### Modify Patterns

To extend what gets documented:

1. Edit `COMMAND_PATTERNS.md` - Add new pattern examples
2. Edit `.claude/skills/tui-cli/SKILL.md` - Update detection rules
3. Edit `scripts/generate_checklist.py` - Modify extraction logic

## Key Files

| File                            | Purpose                          |
| ------------------------------- | -------------------------------- |
| `SKILL.md`                      | Complete skill documentation     |
| `README.md`                     | Quick start and usage guide      |
| `COMMAND_PATTERNS.md`           | TypeScript pattern examples      |
| `INTEGRATION.md`                | This file - workflow integration |
| `scripts/generate_checklist.py` | Main analysis script             |

## Best Practices

### 1. Clear Descriptions

✅ **Good:**

```typescript
.description("Test MCP server health and discover tools")
```

❌ **Bad:**

```typescript
.description("Test server")
```

### 2. Consistent Option Names

✅ **Good:**

```typescript
.option("--json", "Output in JSON format")
.option("-y, --yes", "Skip confirmation")
```

❌ **Bad:**

```typescript
.option("-j", "Output in JSON format")
.option("--confirm", "Skip confirmation")  // Use -y, --yes
```

### 3. Example Code

Always include real examples in code comments or in manual docs:

```typescript
// Example usage:
// mcpsm add my-server --type stdio --command "npx" --args "@mcp/server"
```

### 4. Update Docs After Code

**Order matters:**

1. ✅ Update code → Run skill → Update docs
2. ❌ Don't: Update docs → Change code → Docs are now wrong

## Automation Ideas

You could further automate by:

1. **Git hook** - Run skill before commit
2. **GitHub Action** - Validate docs match code in CI
3. **Pre-PR check** - Ensure all docs are updated

Example pre-commit hook:

```bash
#!/bin/sh
# .git/hooks/pre-commit

if git diff --cached --name-only | grep -q "src/cli\|src/tui"; then
  echo "Running TUI+CLI documentation updater..."
  python3 .claude/skills/tui-cli/scripts/generate_checklist.py
fi
```

## Getting Help

### Inside the Skill

- `SKILL.md` - Full documentation and examples
- `README.md` - Quick start guide
- `COMMAND_PATTERNS.md` - TypeScript pattern reference

### Running the Skill

```bash
# See if script has help/verbose mode
python3 .claude/skills/tui-cli/scripts/generate_checklist.py --help
python3 .claude/skills/tui-cli/scripts/generate_checklist.py -v
```

### If Something's Wrong

1. Check output for error messages
2. Verify file paths and branch
3. Look at example in COMMAND_PATTERNS.md
4. Read SKILL.md troubleshooting section

---

**Version:** 2.0
**Updated:** November 2024
**Project:** MCP Server Manager
