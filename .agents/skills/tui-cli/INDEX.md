# TUI + CLI Parity & Documentation Manager - Documentation Index

Quick navigation for all skill documentation files.

## 📚 File Guide

### 🎯 **Start Here**: README.md

**Path:** `README.md`

Quick start guide for using the skill. Read this first if you're new to the skill.

- ⏱️ Takes 5 minutes to read
- ✅ Contains step-by-step instructions
- 📊 Shows what gets updated automatically
- 🚀 Best practices and tips

**When to read:** Before your first use of the skill

---

### 📖 **Complete Reference**: SKILL.md

**Path:** `SKILL.md`

Full documentation of the skill, how it works, and what it does.

- 📋 Complete feature documentation
- 🔍 File detection patterns
- ✅ Parity checklist items
- 📚 Documentation update map
- 💡 Detailed parsing instructions for Claude
- ⚠️ Preservation rules and validation

**When to read:** When you want detailed information about the skill

---

### 💻 **Developer Patterns**: COMMAND_PATTERNS.md

**Path:** `COMMAND_PATTERNS.md`

TypeScript patterns and examples for writing CLI commands that the skill can properly extract and document.

- ✅ Required command patterns
- ❌ Anti-patterns to avoid
- 📋 All standard option types
- 📝 Good vs bad descriptions
- 🎯 Real-world examples
- ✓ Validation checklist

**When to read:** Before writing or modifying CLI commands

---

### 🔗 **Integration Guide**: INTEGRATION.md

**Path:** `INTEGRATION.md`

How to integrate the skill into your development workflow.

- 🔄 Complete workflow diagram
- 📋 Step-by-step instructions
- 🐛 Troubleshooting guide
- ⚙️ Configuration details
- 💡 Best practices
- 🤖 Automation ideas

**When to read:** When setting up your workflow

---

### 📑 **This File**: INDEX.md

**Path:** `INDEX.md`

Navigation guide (you are here).

---

## 🚀 Quick Start (2 minutes)

### 1. After modifying CLI/TUI code:

```bash
python3 .claude/skills/tui-cli/scripts/generate_checklist.py
```

### 2. Review the output:

- ✅ Documentation was auto-updated
- ✅ Parity checklist was generated
- ✅ No manual edits needed (usually)

### 3. Verify in IDE:

- Open changed `.md` files
- Check formatting looks correct

### 4. Commit:

```bash
git add .
git commit -m "feat: add new command & update docs"
```

---

## 📊 Skill Capabilities

| Capability                     | Details                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| **CLI Command Detection**      | Automatically finds new/modified commands in TypeScript    |
| **Documentation Updates**      | Updates `docs/cli/`, `docs/tui/`, `CLAUDE.md`, `README.md` |
| **Parity Checking**            | Generates checklist for CLI/TUI consistency                |
| **Smart Formatting**           | Maintains existing markdown style and structure            |
| **Option Extraction**          | Parses all command options with descriptions               |
| **Example Handling**           | Preserves manual examples, suggests patterns               |
| **Cross-Reference Validation** | Checks documentation consistency                           |

---

## 📂 File Structure

```
.claude/skills/tui-cli/
│
├── INDEX.md                     ← You are here
├── README.md                    ← Start here for quick intro
├── SKILL.md                     ← Complete skill documentation
├── COMMAND_PATTERNS.md          ← TypeScript pattern examples
├── INTEGRATION.md               ← Workflow integration guide
│
└── scripts/
    └── generate_checklist.py    ← Main analysis script
```

---

## 🎯 When to Use Which File

### Need to... | Read this file

---|---
Add a new CLI command | COMMAND_PATTERNS.md
Modify existing CLI command | COMMAND_PATTERNS.md
Understand what skill does | README.md
Get complete documentation | SKILL.md
Set up workflow | INTEGRATION.md
Fix documentation issues | README.md → Troubleshooting
Write TypeScript correctly | COMMAND_PATTERNS.md
Debug script problems | INTEGRATION.md → Troubleshooting

---

## ⚡ Common Tasks

### Task: Add a new CLI command

1. **Read:** `COMMAND_PATTERNS.md` - See examples
2. **Write:** Implement in `src/cli/commands/`
3. **Run:** `python3 scripts/generate_checklist.py`
4. **Verify:** Check `docs/cli/` and `CLAUDE.md` updated
5. **Commit:** Include doc updates in commit

### Task: Modify existing command

1. **Read:** `COMMAND_PATTERNS.md` - Review patterns
2. **Edit:** `src/cli/commands/` - Make changes
3. **Run:** `python3 scripts/generate_checklist.py`
4. **Review:** Verify docs match new signature
5. **Commit:** Include doc updates

### Task: Add TUI screen

1. **Read:** `README.md` - See what gets updated
2. **Create:** Screen in `src/tui/screens/`
3. **Run:** `python3 scripts/generate_checklist.py`
4. **Verify:** Check `docs/tui/` updated
5. **Commit:** Include doc updates

### Task: Troubleshoot documentation

1. **Read:** `INTEGRATION.md` - Check troubleshooting
2. **Review:** Source TypeScript file
3. **Check:** Descriptions are clear
4. **Fix:** Source if needed
5. **Re-run:** Script

---

## 📝 Documentation Files That Get Updated

| File                    | Updates            | Trigger                     |
| ----------------------- | ------------------ | --------------------------- |
| `docs/cli/*.md`         | Command docs       | Modify `src/cli/commands/`  |
| `docs/tui/screens.md`   | TUI screens        | Modify `src/tui/screens/`   |
| `docs/tui/shortcuts.md` | Key bindings       | Modify `src/tui/index.ts`   |
| `docs/tui/overview.md`  | Navigation         | Modify screens or shortcuts |
| `CLAUDE.md`             | Quick reference    | Modify any CLI command      |
| `README.md`             | Feature highlights | Major CLI/TUI changes       |

---

## 🔑 Key Concepts

### Parity

Both CLI and TUI should have feature parity - same features available in both interfaces.

### Documentation Auto-Update

The skill automatically extracts command information from TypeScript source and updates relevant `.md` files.

### Preservation

Existing documentation and examples are preserved; only command signatures and descriptions are updated.

### Checklist

After updates, you get a checklist of items to manually verify (testing, examples, cross-references, etc.).

---

## 🚦 Workflow Checklist

```
□ Feature branch created (git checkout -b matt/<name>)
□ Code changes implemented (CLI/TUI/both)
□ Code compiles without errors (npm run build)
□ Manual testing completed
□ Skill run: python3 .claude/skills/tui-cli/scripts/generate_checklist.py
□ Documentation reviewed in IDE
□ Formatting checked (npm run lint:fix)
□ Tests pass (npm test)
□ Changes committed
□ PR created
```

---

## 💡 Pro Tips

1. **Run the skill immediately after code changes** - While fresh in your mind
2. **Review documentation in IDE** - See formatting before committing
3. **Keep descriptions short and clear** - Better extraction and docs
4. **Use consistent option names** - `--json`, `-y, --yes` across commands
5. **Update CLAUDE.md manually** - Quick reference needs polish
6. **Test the command** - Before running the skill
7. **Include doc changes in commits** - They're part of the feature

---

## 🆘 Getting Help

### If skill doesn't work:

1. Check `INTEGRATION.md` Troubleshooting section
2. Review Python script in `scripts/`
3. Verify you're in right directory
4. Run with verbose: `python3 ... -v`

### If documentation looks wrong:

1. Check your TypeScript descriptions
2. Review `COMMAND_PATTERNS.md` examples
3. Manually fix in `.md` files
4. Report issue with details

### If you need new feature:

1. Check "Future Enhancements" in `README.md`
2. Consider if it's a script change or pattern change
3. Ask about automation ideas in `INTEGRATION.md`

---

## 📞 Quick Links

- **Python Script:** `.claude/skills/tui-cli/scripts/generate_checklist.py`
- **CLI Commands:** `src/cli/commands/`
- **TUI Screens:** `src/tui/screens/`
- **CLI Docs:** `docs/cli/`
- **TUI Docs:** `docs/tui/`
- **Quick Ref:** `CLAUDE.md` (CLI Commands section)
- **Main Docs:** `README.md`

---

## 📊 Statistics

- **Documentation Files:** 4 (this suite)
- **Project Files to Update:** 7-9
- **Skill Functions:** 5+
- **Supported Command Features:** 10+
- **Time to Run:** ~5-30 seconds
- **Time to Review Results:** ~5-10 minutes

---

**Version:** 2.0
**Updated:** November 2024
**For:** MCP Server Manager v2.0+
**Status:** ✅ Production Ready
