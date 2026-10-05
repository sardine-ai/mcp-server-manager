# TUI+CLI Skill - Expansion Summary

## What's New?

The `tui-cli` skill has been **significantly expanded** to automatically update project documentation whenever you modify CLI or TUI code.

### Before (v1)

- ✅ Generated parity checklists
- ❌ Documentation updates were manual

### After (v2)

- ✅ Generates parity checklists
- ✅ **Automatically updates documentation**
- ✅ Extracts command information from TypeScript
- ✅ Maintains existing examples and formatting
- ✅ Comprehensive guidance for developers

---

## Quick Start

### 1. After modifying CLI/TUI code, run:

```bash
python3 .claude/skills/tui-cli/scripts/generate_checklist.py
```

### 2. The skill will:

✅ Extract new/modified commands from TypeScript
✅ Update `docs/cli/` with command documentation
✅ Update `docs/tui/` with screen/shortcut info
✅ Update `CLAUDE.md` quick reference
✅ Generate parity checklist

### 3. Verify in IDE:

- Open updated `.md` files
- Check formatting looks good
- Commit changes along with code

---

## What Gets Updated Automatically?

| Change                               | Documentation Updated                                |
| ------------------------------------ | ---------------------------------------------------- |
| Modify `src/cli/commands/*.cmd.ts`   | `docs/cli/<category>.md` + `CLAUDE.md` + `README.md` |
| Modify `src/tui/screens/*.screen.ts` | `docs/tui/screens.md` + `docs/tui/overview.md`       |
| Modify `src/tui/index.ts`            | `docs/tui/shortcuts.md` + `docs/tui/overview.md`     |

---

## New Documentation Files

Five comprehensive guides are now available:

### 📖 README.md (6.9 KB)

**Start here** - Quick intro to how the skill works

- Quick start guide
- What gets updated
- How to use
- Troubleshooting
- Best practices

**Read:** First time using the skill

---

### 📋 SKILL.md (8.1 KB)

**Complete reference** - Full technical documentation

- How it works in detail
- Feature detection map
- Parity checklist items
- Documentation update map
- Detailed extraction instructions for Claude
- Preservation rules

**Read:** When you need detailed information

---

### 💻 COMMAND_PATTERNS.md (11 KB)

**For developers** - TypeScript patterns for CLI commands

- Required command patterns
- Option formats and examples
- Description guidelines
- Real-world examples
- Anti-patterns to avoid
- Validation checklist

**Read:** Before writing/modifying CLI commands

---

### 🔗 INTEGRATION.md (10 KB)

**Workflow guide** - How to integrate into your development

- Workflow diagram (visual)
- Step-by-step instructions
- Running the skill
- Expected output examples
- When to use/skip
- Troubleshooting
- Best practices
- Automation ideas

**Read:** When setting up your workflow

---

### 📑 INDEX.md (8.1 KB)

**Navigation** - Find what you need quickly

- Quick links to all files
- "When to read" guide
- Common tasks with steps
- File structure
- Getting help

**Read:** When looking for something specific

---

## Key Features

### 🤖 Automatic Extraction

The skill automatically extracts from TypeScript:

```typescript
// Your code
program
  .command("test [server]")
  .description("Test MCP server health and tools")
  .option("--json", "Output in JSON format")
  .option("-v, --verbose", "Verbose output")
  .action(async (server, options) => {});
```

**Becomes this documentation:**

```markdown
## test

Test MCP server health and tools.

### Usage

\`\`\`bash
mcpsm test [server] [options]
\`\`\`

### Options

| Option          | Description           |
| --------------- | --------------------- |
| `[server]`      | Server name to test   |
| `--json`        | Output in JSON format |
| `-v, --verbose` | Verbose output        |
```

### 📝 Smart Preservation

All your manual work is preserved:

- ✅ Existing commands never removed
- ✅ Custom examples kept intact
- ✅ Markdown formatting maintained
- ✅ Manual notes preserved
- ✅ Only command signatures updated

### ✓ Parity Checklist

After running, you get items like:

- [ ] Business logic in services
- [ ] Function exported for CLI + TUI
- [x] Command in src/cli/commands/
- [x] Supports --json flag
- [ ] CLI commands documented
- [ ] TUI screens documented

---

## Workflow Integration

### Standard Workflow:

```
1. Create feature branch
   ↓
2. Implement CLI/TUI code changes
   ↓
3. Run skill: python3 .claude/skills/tui-cli/scripts/generate_checklist.py
   ↓
4. Review documentation in IDE
   ↓
5. Commit with doc updates
   ↓
6. Create PR
```

### Before committing:

```bash
npm run lint:fix    # Auto-fix formatting
npm test            # Run parity tests
git add .
git commit -m "feat: add command & update docs"
```

---

## File Structure

```
.claude/skills/tui-cli/
├── README.md              ← START HERE
├── SKILL.md               ← Full documentation
├── COMMAND_PATTERNS.md    ← TypeScript examples
├── INTEGRATION.md         ← Workflow guide
├── INDEX.md               ← Navigation
├── SUMMARY.md             ← This file
└── scripts/
    └── generate_checklist.py
```

---

## Common Questions

### Q: Do I need to manually update documentation?

**A:** No! The skill updates it automatically. You may need to manually polish examples or update README.

### Q: What if the documentation looks wrong?

**A:** Check your TypeScript descriptions. If they're unclear, fix them and re-run the skill.

### Q: Will my existing examples be deleted?

**A:** No! The skill preserves all existing text and only updates command signatures.

### Q: What if I don't want documentation updated?

**A:** Run the script for the checklist, but you can manually revert doc changes if needed.

### Q: How long does it take?

**A:** Script runs in 5-30 seconds. Reviewing results takes 5-10 minutes.

### Q: Can I customize what gets updated?

**A:** Edit `scripts/generate_checklist.py` to modify behavior.

---

## Example Usage

### Adding a new command:

```typescript
// Step 1: Write TypeScript (src/cli/commands/utility.cmd.ts)
program
  .command("tokens")
  .description("Show API token usage statistics")
  .option("--json", "Output in JSON format")
  .action(async (options) => {
    // implementation
  });
```

```bash
# Step 2: Run the skill
python3 .claude/skills/tui-cli/scripts/generate_checklist.py
```

```
# Step 3: Documentation automatically updated!
✅ docs/cli/utilities.md - Added "tokens" command
✅ CLAUDE.md - Updated quick reference
```

```bash
# Step 4: Commit changes
git add .
git commit -m "feat: add tokens command to show API usage"
```

---

## Documentation Updates Reference

### docs/cli/<category>.md

**Updated when:** You modify `src/cli/commands/<category>.cmd.ts`

**What changes:**

- Command signature
- Options list
- Usage examples (if you update them)

**What's preserved:**

- Explanatory text
- Custom examples
- Command ordering

### CLAUDE.md (CLI Commands section)

**Updated when:** Any CLI command is added/modified

**What changes:**

- Quick reference entries
- Command descriptions

**Format:**

```
mcpsm command [args]     Short description
```

### docs/tui/screens.md

**Updated when:** You modify `src/tui/screens/` files

**What changes:**

- Screen listings
- Descriptions
- Feature lists

### docs/tui/shortcuts.md

**Updated when:** You modify `src/tui/index.ts` (key bindings)

**What changes:**

- Shortcut listings
- Key combinations
- Action descriptions

### README.md

**Updated when:** Major CLI features added

**What changes:**

- Feature highlights (optional)
- Command listings (if applicable)

---

## Getting Help

1. **Quick answer?** → `README.md`
2. **Need patterns?** → `COMMAND_PATTERNS.md`
3. **Workflow help?** → `INTEGRATION.md`
4. **Complete info?** → `SKILL.md`
5. **Finding something?** → `INDEX.md`

---

## Tips for Success

### ✅ Do This

- Write clear, concise descriptions in TypeScript
- Use consistent option names (`--json`, `-y, --yes`)
- Include meaningful option descriptions
- Test your command before running skill
- Review generated docs in IDE
- Keep examples realistic
- Commit doc updates with code changes

### ❌ Don't Do This

- Make descriptions too long or vague
- Use custom option names that don't match project conventions
- Skip descriptions for options
- Assume docs are correct without reviewing
- Revert doc updates without reason
- Delete manual examples when skill updates

---

## Version Info

- **Skill Version:** 2.0
- **Status:** Production Ready ✅
- **Updated:** November 2024
- **Compatible with:** MCP Server Manager v2.0+
- **Python Script:** Backward compatible

---

## What's Next?

1. Read `README.md` for quick start
2. Check `COMMAND_PATTERNS.md` before modifying CLI code
3. Use the skill on your next feature
4. Review generated documentation
5. Share feedback!

---

## Quick Command Reference

```bash
# Run the skill
python3 .claude/skills/tui-cli/scripts/generate_checklist.py

# With verbose output
python3 .claude/skills/tui-cli/scripts/generate_checklist.py -v

# View your changes
git diff docs/

# After reviewing
npm run lint:fix
npm test
```

---

**Happy documenting! The skill handles the tedious work so you can focus on code.**

Questions? Check the guides above or review the source files.
