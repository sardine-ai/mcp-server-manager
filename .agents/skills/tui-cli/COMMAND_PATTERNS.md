# CLI Command Patterns

This document shows the **expected TypeScript patterns** for CLI commands so that documentation can be automatically extracted.

## Required Pattern

For commands to be properly documented, follow this pattern in `src/cli/commands/*.cmd.ts`:

### Basic Command

```typescript
import { Command } from "commander";
import { colors, c } from "../../shared/colors.js";
import { getConfigService } from "../../services/config.service.js";

/** Register server commands */
export function registerServerCommands(program: Command): void {
  program
    .command("test [server]")
    .alias("t") // Optional
    .description("Test MCP server health and tools")
    .option("--json", "Output in JSON format") // Common flag
    .option("-v, --verbose", "Verbose output") // Short + long form
    .action(async (server, options) => {
      // Implementation
    });
}
```

## Pattern Details

### ✅ Do This

```typescript
// ✅ CORRECT: Clear command structure
program
  .command("command-name [optional-arg] <required-arg>")
  .alias("cn") // or .aliases(["cn", "c"])
  .description("Clear, concise description of what this command does")
  .option("--json", "Output results in JSON format")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("-n, --name <value>", "Named option with value")
  .option("-c, --count <number>", "Numeric option")
  .action(async (optionalArg, requiredArg, options) => {
    const service = getConfigService();

    if (options.json) {
      outputJson(data);
      return;
    }

    // Success
    console.log(`${c.checkmark} Command completed successfully`);

    // Error
    console.log(`${c.cross} Error message`);
    process.exit(1);
  });
```

### ❌ Don't Do This

```typescript
// ❌ WRONG: Inconsistent patterns
program.command("cmd");  // No description - won't document

program
  .command("list")
  // Missing: .description()
  .option("-f", "Flag without proper description")  // Cryptic
  .action(() => { });

// ❌ WRONG: Non-standard options
.option("-f, --flag")  // Description missing
.option("--json", undefined)  // Empty description
.option("--flag<value>")  // Space missing in pattern

// ❌ WRONG: Unclear arguments
program.command("cmd a b c")  // Don't use generic 'a', 'b', 'c'
program.command("cmd [x]")  // Use descriptive names like [server]
```

## Option Formats

### Standard Patterns

```typescript
// Boolean flags (no value)
.option("--json", "Output in JSON format")
.option("-q, --quiet", "Suppress output")

// Flags with values
.option("-n, --name <name>", "Name to use")
.option("-c, --count <number>", "Number of items")
.option("-p, --port <port>", "Port number")

// Multiple short forms (choose one style)
.option("-y, --yes", "Confirm action")  // Standard
.option("-f, --force", "Force operation")

// Less common but valid
.option("--key-name <value>", "Kebab-case key")
.option("--flag <optional>", "Description")  // Optional value
```

### What Gets Documented

The extraction finds:

- Flag name(s): `--json`, `-y, --yes`
- Value placeholder: `<name>`, `<number>`
- Description: Everything after the flag definition

**Example output:**

```markdown
| Option                 | Description           |
| ---------------------- | --------------------- |
| `--json`               | Output in JSON format |
| `-y, --yes`            | Confirm action        |
| `-n, --name <name>`    | Name to use           |
| `-c, --count <number>` | Number of items       |
```

## Command Arguments

### Argument Syntax

```typescript
// Optional argument
.command("list [server]")  // [name] means optional

// Required argument
.command("remove <server>")  // <name> means required

// Multiple arguments
.command("copy <source> <destination>")

// Multiple optional
.command("sync [from] [to]")
```

### In Documentation

Gets converted to:

```markdown
\`\`\`bash
mcpsm list [server] [options]
mcpsm remove <server> [options]
mcpsm copy <source> <destination> [options]
mcpsm sync [from] [to] [options]
\`\`\`
```

## Description Guidelines

### Requirements

- **Must be concise** (one sentence, ~60 characters max)
- **Start with verb** ("List servers", "Test connection")
- **Use active voice** ("Enable the server" not "Enables server")
- **Be specific** ("List all servers" better than "Show servers")

### Good Descriptions

```typescript
.description("List all MCP servers")
.description("Test MCP server health and discover tools")
.description("Remove an MCP server")
.description("Enable server for all clients")
.description("Synchronize servers to clients")
.description("Get detailed server configuration")
.description("Test server health and retrieve tool list")
```

### Bad Descriptions

```typescript
.description("Server list")  // Too terse
.description("Do stuff with servers")  // Too vague
.description("Lists all the MCP servers in the system")  // Too long
.description("Server")  // Way too short
.description("manage")  // Not descriptive enough
```

## Common Command Categories

### Server Management (`daemon.cmd.ts`)

```typescript
.command("start")
.description("Start the MCP daemon")

.command("stop")
.description("Stop the MCP daemon")

.command("status")
.description("Check daemon status")

.command("logs")
.description("View daemon logs")
```

### Server Operations (`server.cmd.ts`)

```typescript
.command("list [--json]")
.description("List all configured servers")

.command("add [name]")
.description("Add a new server (interactive)")

.command("remove <server>")
.description("Remove a server")

.command("test [server]")
.description("Test server health and discover tools")

.command("enable <server>")
.description("Enable server for all clients")

.command("disable <server>")
.description("Disable server for all clients")
```

### Profile Management (`profile.cmd.ts`)

```typescript
.command("list")
.description("List all profiles")

.command("create [name]")
.description("Create a new profile")

.command("use <profile>")
.description("Activate a profile")

.command("delete <profile>")
.description("Delete a profile")
```

## Option Naming Standards

### Consistent Across Commands

Use these standard options for consistency:

| Option          | Use Case             | Example                      |
| --------------- | -------------------- | ---------------------------- |
| `--json`        | JSON output          | All list/show commands       |
| `-y, --yes`     | Skip confirmation    | All destructive commands     |
| `-v, --verbose` | Detailed output      | Test, daemon, debug commands |
| `-q, --quiet`   | Minimal output       | Opposite of verbose          |
| `--force, -f`   | Bypass safety checks | Remove, delete commands      |
| `--all`         | Process everything   | When filtering available     |
| `--dry-run`     | Preview action       | For risky operations         |

## Real World Examples

### Example 1: List with Options

```typescript
program
  .command("list")
  .description("List all MCP servers with status")
  .option("--json", "Output in JSON format")
  .option("--filter <type>", "Filter by type: stdio, http, or sse")
  .option("--sort <field>", "Sort by: name, status, or type")
  .option("-a, --all", "Include disabled servers")
  .action(async (options) => {
    // ... implementation
  });
```

Documentation becomes:

```markdown
## list

List all MCP servers with status.

### Usage

\`\`\`bash
mcpsm list [options]
\`\`\`

### Options

| Option            | Description                         |
| ----------------- | ----------------------------------- |
| `--json`          | Output in JSON format               |
| `--filter <type>` | Filter by type: stdio, http, or sse |
| `--sort <field>`  | Sort by: name, status, or type      |
| `-a, --all`       | Include disabled servers            |

### Examples

\`\`\`bash

# List all servers

mcpsm list

# List in JSON format

mcpsm list --json

# List HTTP servers only

mcpsm list --filter http

# Show disabled servers too

mcpsm list --all
\`\`\`
```

### Example 2: Action with Confirmation

```typescript
program
  .command("remove <server>")
  .description("Remove an MCP server")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (server, options) => {
    const service = getConfigService();

    // Confirm unless --yes
    if (!options.yes) {
      const confirmed = await promptConfirm(`Remove server "${server}"? This cannot be undone.`);
      if (!confirmed) return;
    }

    const result = service.removeServer(server);
    if (result.success) {
      console.log(`${c.checkmark} Server removed`);
    } else {
      console.log(`${c.cross} ${result.error}`);
      process.exit(1);
    }
  });
```

### Example 3: With Subcommands

```typescript
const clientsCmd = program.command("clients").description("Manage MCP client connections");

clientsCmd
  .command("list")
  .description("List detected MCP clients")
  .option("--json", "Output in JSON format")
  .action(async (options) => {
    // Implementation
  });

clientsCmd
  .command("sync")
  .description("Sync servers to detected clients")
  .option("-y, --yes", "Skip confirmation")
  .action(async (options) => {
    // Implementation
  });
```

## Extraction Logic

The skill extracts patterns:

```typescript
// Pattern 1: Command registration
.command("name [args]")        // Extracted: "name [args]"

// Pattern 2: Aliases
.alias("short")                // Extracted: alias="short"
.aliases(["a", "b"])           // Extracted: all aliases

// Pattern 3: Description
.description("..."             // Extracted: full description

// Pattern 4: Options
.option("--flag <val>", "...")  // Extracted: flag, value placeholder, description

// Pattern 5: Arguments
.action((arg1, arg2, options)   // Matched against .command() parameters
```

## Validation Checklist

Before committing CLI changes:

- [ ] Command has `.description()`
- [ ] All options have descriptions
- [ ] Option descriptions are clear and concise
- [ ] Arguments use descriptive names, not generic letters
- [ ] Standard options (`--json`, `-y`) used consistently
- [ ] Short options (`-y`) paired with long options (`--yes`)
- [ ] No typos in descriptions
- [ ] Command follows naming conventions (use hyphens, lowercase)
- [ ] Related commands use similar patterns
- [ ] Try it: `mcpsm <command> --help` shows useful help text

## Common Mistakes

| Problem                    | Solution                                                  |
| -------------------------- | --------------------------------------------------------- |
| Missing description        | Add `.description("...")`                                 |
| Option without description | Always provide description string                         |
| Unclear abbreviations      | Use descriptive option names, not cryptic ones            |
| Inconsistent naming        | Follow project conventions (see Standards section)        |
| Generic argument names     | Use specific names: `<server>` not `<name>`               |
| Missing required flag      | If option should always be there, document in description |
| Breaking existing pattern  | Check similar commands first                              |

---

**Last Updated:** November 2024
**For Project:** MCP Server Manager v2.0+
