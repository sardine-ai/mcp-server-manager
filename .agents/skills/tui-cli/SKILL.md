---
name: tui-cli
description: Ensures TUI+CLI+Documentation parity for all feature changes. CRITICAL - Use this for EVERY change that affects commands, screens, shortcuts, or settings. Validates that changes are reflected in TUI implementation, CLI commands, docs/cli/, docs/tui/, docs/tui/shortcuts.md, AGENTS.md, and feature registry. Prevents documentation drift and missing implementations.
---

# TUI + CLI + Documentation Parity Enforcer

**⚠️ CRITICAL USAGE:** This skill MUST be invoked for EVERY change that affects:

- Commands (CLI or TUI)
- Keyboard shortcuts
- Screens or UI elements
- Settings or configuration
- Feature additions/modifications

## Core Principle

Every feature in this project requires **three-way parity**:

1. **TUI Implementation** - Interactive terminal UI with keyboard shortcuts
2. **CLI Implementation** - Command-line interface with flags and options
3. **Documentation** - Multiple doc files must stay synchronized

**Missing any one = broken user experience.**

## How It Works

The skill:

1. **Detects your branch** - If on a feature branch, compares with `main`; if on `main`, shows staged/unstaged changes
2. **Maps changed files** - Groups modifications by feature type (CLI commands, TUI screens, shared logic, etc.)
3. **Extracts command info** - Parses new/modified CLI commands from TypeScript files
4. **Updates documentation** - Automatically updates `docs/cli/`, `docs/tui/`, `AGENTS.md`, and `README.md` with new commands and features
5. **Generates checklists** - Creates customized verification items for each affected feature
6. **Filters noise** - Ignores config files (package.json, package-lock.json) and re-export index files

## Usage

Run the analysis script to generate your parity checklist and update documentation:

```bash
python3 .Codex/skills/tui-cli/scripts/generate_checklist.py
```

**Output includes:**

- 🌿 Current branch info
- 🔍 Number of source files modified across features
- 📦 Configuration/dependency files (listed separately)
- 📚 Documentation files that were updated
- Feature-grouped file list
- Customized parity checklist for each feature

## Documentation Update Map

The skill automatically updates documentation based on file changes:

| Changed File                  | Documentation Updates                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `src/cli/commands/*.cmd.ts`   | `docs/cli/<category>.md`, `AGENTS.md` (CLI Commands section), `README.md` |
| `src/tui/screens/*.screen.ts` | `docs/tui/screens.md`, `docs/tui/overview.md`                             |
| `src/tui/index.ts`            | `docs/tui/shortcuts.md`, `docs/tui/overview.md`                           |
| `src/services/*.service.ts`   | (No direct doc update, but noted in parity checklist)                     |
| `src/shared/features.ts`      | (Feature registry validation in checklist)                                |

### Documentation File Formats

#### `docs/cli/<category>.md`

Each command category has its own file with:

- Command heading: `## <command-name>`
- Description paragraph
- Usage block: ` ```bash\nmcpsm <command> [options]\n``` `
- Options table with pipes: `| Option | Description |`
- Examples with code blocks
- Output samples (where applicable)

#### `docs/tui/screens.md`

Lists all TUI screens with:

- Screen name
- Description
- Key bindings/navigation
- Features available

#### `docs/tui/shortcuts.md`

Keyboard shortcuts reference with:

- Shortcut key(s)
- Action description
- Context/screen where applicable

#### `AGENTS.md` (CLI Commands section)

Quick reference format:

```text
mcpsm command [args]     Brief description
mcpsm command2 <param>   Another description
```

#### `README.md`

- Main feature highlights
- Common commands (top-level only)
- Links to full documentation

## Feature Detection Map

The skill recognizes these file patterns:

```text
src/cli/commands/        → CLI Command Implementation
src/tui/screens/         → TUI Screen Implementation
src/tui/index.ts         → TUI Main Screen/Key Bindings
src/services/*.ts        → Shared Business Logic
src/shared/features.ts   → Feature Registry
tests/                   → Test Coverage
```

## Parity Checklist Items

For each modified feature, you'll verify:

### 1. Shared Logic

- [ ] Business logic in `src/services/`
- [ ] Function exported for CLI + TUI use
- [ ] I/O separated from core logic

### 2. CLI Implementation

- [ ] Command in `src/cli/commands/`
- [ ] Supports `--json` flag if applicable
- [ ] Supports `-y`/`--force` if applicable

### 3. TUI Implementation

- [ ] Screen/handler in `src/tui/`
- [ ] Keyboard shortcuts documented
- [ ] State management consistent with CLI

### 4. Feature Registry

- [ ] Updated `src/shared/features.ts`
- [ ] Defines `id`, `name`, `category`
- [ ] Lists `cliCommands` and `tuiImplementation`

### 5. Documentation

- [ ] CLI commands documented in `docs/cli/<category>.md`
- [ ] New options documented with descriptions and examples
- [ ] TUI screens documented in `docs/tui/screens.md` (if applicable)
- [ ] Quick reference in `AGENTS.md` updated
- [ ] README.md updated if feature is user-facing

### 6. Testing

- [ ] Run `npm test` for parity verification
- [ ] Feature in both CLI and TUI
- [ ] Behavior consistent across interfaces

## Instructions for Codex When Updating Documentation

When this skill detects CLI/TUI changes, Codex will:

### 1. Parse CLI Commands

Extract from TypeScript files (`src/cli/commands/*.cmd.ts`):

- **Command name** - From `.command("name [args]")`
- **Aliases** - From `.aliases([...])`
- **Description** - From `.description("...")`
- **Options** - From `.option("--flag <value>", "description")`
- **Examples** - Comment-based or inferred from usage patterns

**Example extraction from TypeScript:**

```typescript
program
  .command("test [server]")
  .description("Test MCP server health and tools")
  .option("--json", "Output in JSON format")
  .option("-v, --verbose", "Verbose output")
  .action(async (server, options) => {
    // implementation
  });
```

Becomes in documentation:

```markdown
## test

Test MCP server health and tools.

### Usage

\`\`\`bash
mcpsm test [server] [options]
\`\`\`

### Options

| Option          | Description                                |
| --------------- | ------------------------------------------ |
| `[server]`      | Server name to test (tests all if omitted) |
| `--json`        | Output in JSON format                      |
| `-v, --verbose` | Verbose output                             |

### Examples

\`\`\`bash

# Test a specific server

mcpsm test my-server

# Test all servers with verbose output

mcpsm test --verbose
\`\`\`
```

### 2. Update Documentation Files

**For `docs/cli/<category>.md`:**

- Keep existing commands, update modified ones
- Add new commands maintaining the format
- Preserve all explanatory text and examples
- Use horizontal rule `---` between commands

**For `AGENTS.md` (CLI Commands section):**

- Update quick reference: `mcpsm command [args]     Description`
- Keep format consistent with existing commands
- Maintain alphabetical order within sections

**For `README.md`:**

- Update highlights if major new feature
- Link to documentation files
- Keep user-friendly language

### 3. Preservation Rules

- **Never remove** commands from documentation (mark as deprecated if needed)
- **Always preserve** existing examples and explanations
- **Maintain formatting** - Don't change markdown styles
- **Keep order** - Don't reorder existing commands

### 4. Validation

- Use `npm run lint` to verify formatting
- Test documentation formatting: open generated `.md` files
- Verify command syntax matches actual implementation

## Example Output

**On main branch with no changes:**

```text
✅ No changes detected - nothing needs to be done
```

**On feature branch with CLI + TUI changes:**

```text
🌿 Current branch: matt/implement-gateway

🔍 Detected 5 source file(s) across 3 feature(s)
📦 Also modified: `package-lock.json`, `package.json` (config/deps)

📚 Documentation Updates:
   ✅ docs/cli/daemon.md - Updated 2 commands
   ✅ docs/tui/screens.md - Added DaemonScreen
   ✅ AGENTS.md - Updated CLI Commands section
   ✅ README.md - Updated feature list

### Modified Files by Feature

**DAEMON**
  - [CLI] src/cli/commands/daemon.cmd.ts

**DAEMONSCREEN**
  - [TUI] src/tui/screens/DaemonScreen.tsx
  - [TUI] tests/tui/screens/DaemonScreen.test.tsx

**GATEWAY**
  - [Logic] src/services/gateway.service.ts

### Parity Checklist

[Customized checklist for each feature...]

- [x] CLI commands documented
- [x] TUI screens documented
- [x] Quick reference updated
- [ ] README highlights updated (if needed)
```
