/**
 * MCP Server Manager CLI
 * Main entry point for the command-line interface
 */

import { Command } from "commander";
import { c } from "../shared/colors.js";

// Import command modules
import { registerServerCommands } from "./commands/server.cmd.js";
import { registerClientCommands } from "./commands/client.cmd.js";
import { registerProfileCommands } from "./commands/profile.cmd.js";
import { registerSettingsCommands } from "./commands/settings.cmd.js";
import { registerToolsCommands } from "./commands/tools.cmd.js";
import { registerUtilityCommands } from "./commands/utility.cmd.js";
import { registerDaemonCommands } from "./commands/daemon.cmd.js";
import { registerImportExportCommands } from "./commands/import-export.cmd.js";
import { registerAuthCommands } from "./commands/auth.cmd.js";
import { registerBridgeCommands } from "./commands/bridge.cmd.js";

/** Package version */
import { VERSION } from "../shared/version.js";

/** Create and configure the CLI program */
function createProgram(): Command {
  const program = new Command();

  program
    .name("mcpsm")
    .description("MCP Server Manager - Manage MCP servers across multiple AI clients")
    .version(VERSION, "-v, --version", "Show version number")
    .option("--json", "Output in JSON format (where supported)")
    .option("--quiet", "Suppress non-essential output")
    .option("--verbose", "Show detailed output")
    .hook("preAction", (_thisCommand, actionCommand) => {
      // Store global options in command for access in handlers
      const opts = program.opts();
      if (opts.json) actionCommand.setOptionValue("json", true);
      actionCommand.setOptionValue("globalJson", opts.json);
      actionCommand.setOptionValue("globalQuiet", opts.quiet);
      actionCommand.setOptionValue("globalVerbose", opts.verbose);
    });

  // Register all command modules
  registerServerCommands(program);
  registerClientCommands(program);
  registerProfileCommands(program);
  registerSettingsCommands(program);
  registerToolsCommands(program);
  registerUtilityCommands(program);
  registerDaemonCommands(program);
  registerImportExportCommands(program);
  registerAuthCommands(program);
  registerBridgeCommands(program);

  // Default action - show TUI or help
  program.action(async () => {
    // If no command specified, launch TUI
    try {
      const { startTui } = await import("../tui/index.js");
      await startTui();
    } catch {
      // TUI not available, show help
      program.help();
    }
  });

  return program;
}

/** Main entry point */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`${c.cross} ${c.error(error.message)}`);
      if (program.opts().verbose) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error(`${c.cross} Fatal error:`, error);
  process.exit(1);
});

export { createProgram, VERSION };
