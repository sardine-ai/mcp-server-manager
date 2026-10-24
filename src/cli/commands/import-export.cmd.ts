/**
 * CLI commands for import/export operations
 */

import { Command } from "commander";
import path from "path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { colors } from "../../shared/colors.js";
import { outputJson } from "../../shared/formatters.js";
import { getImportExportService } from "../../services/import-export.service.js";
import type { ExportFormat } from "../../services/import-export.service.js";
import type { ConflictResolution } from "../../types/index.js";

/** Register import/export commands */
export function registerImportExportCommands(program: Command): void {
  // import command
  program
    .command("import [file]")
    .description("Import servers from file or client")
    .option("--from <client>", "Import from a client (claude, cursor, windsurf, kiro, zed)")
    .option("--overwrite", "Overwrite conflicting servers (non-interactive mode)")
    .option("--skip", "Skip conflicting servers (non-interactive mode)")
    .option("--merge", "Intelligently merge conflicting servers (non-interactive mode)")
    .option("--force", "Alias for --overwrite (deprecated)")
    .action(async (file: string | undefined, options) => {
      await handleImport(file, options);
    });

  // export command
  program
    .command("export")
    .description("Export server configuration")
    .option("-f, --format <format>", "Export format (mcpsm, json)", "mcpsm")
    .option("-o, --output <file>", "Output file path")
    .action(async (options) => {
      await handleExport(options);
    });
}

/** Handle import command */
async function handleImport(
  file: string | undefined,
  options: {
    from?: string;
    overwrite?: boolean;
    skip?: boolean;
    merge?: boolean;
    force?: boolean;
  }
): Promise<void> {
  const importExportService = getImportExportService();

  let result;

  if (options.from) {
    // Import from client
    console.log(`Importing from ${options.from}...`);
    result = importExportService.importFromClient(options.from);
  } else if (file) {
    // Import from file
    const filePath = path.resolve(file);
    console.log(`Importing from ${filePath}...`);
    result = importExportService.importFromFile(filePath);
  } else {
    // Show usage
    console.log(`\n${colors.bright}${colors.cyan}Import Servers${colors.reset}\n`);
    console.log(`Usage:`);
    console.log(`  mcpsm import <file.json>           Import from JSON file`);
    console.log(`  mcpsm import --from claude         Import from Claude Desktop`);
    console.log(`  mcpsm import --from cursor         Import from Cursor`);
    console.log(`  mcpsm import --from windsurf       Import from Windsurf`);
    console.log(`  mcpsm import --from kiro           Import from Kiro`);
    console.log(`  mcpsm import --from zed            Import from Zed`);
    console.log(`\nConflict Resolution Options:`);
    console.log(`  --overwrite                        Overwrite conflicting servers`);
    console.log(`  --skip                             Skip conflicting servers (default)`);
    console.log(`  --merge                            Intelligently merge conflicting servers`);
    console.log(`\nWhen no conflict option is provided, interactive mode will prompt per-server.`);
    console.log(`\n${colors.bright}${colors.cyan}Export Servers${colors.reset}\n`);
    console.log(`  mcpsm export -f mcpsm              Export to MCPSM format (default)`);
    console.log(`  mcpsm export -f json               Export to JSON format (MCP Standard)`);

    // Show available sources
    const sources = importExportService.getAvailableSources();
    if (sources.length > 0) {
      console.log(`\n${colors.bright}Available sources:${colors.reset}`);
      for (const source of sources) {
        console.log(
          `  ${colors.green}${source.clients.join(", ")}${colors.reset} - ${source.description}`
        );
      }
    }
    return;
  }

  if (!result.success) {
    console.error(`${colors.red}Error: ${result.error}${colors.reset}`);
    process.exit(1);
  }

  const servers = result.servers || [];
  console.log(
    `${colors.green}✓${colors.reset} Found ${servers.length} server(s) (${result.format} format)`
  );

  if (servers.length === 0) {
    console.log(`${colors.yellow}No servers to import.${colors.reset}`);
    return;
  }

  // Detect conflicts
  const conflicts = importExportService.detectConflicts(servers);

  // Show preview
  console.log(`\n${colors.bright}Servers to import:${colors.reset}`);
  for (const server of servers) {
    const type =
      server.serverType === "remote"
        ? `${colors.blue}remote${colors.reset}`
        : `${colors.green}local${colors.reset}`;
    console.log(`  - ${colors.cyan}${server.name || server.id}${colors.reset} (${type})`);
  }

  // Handle conflicts
  const decisions = new Map<string, ConflictResolution>();

  if (conflicts.totalConflicts > 0) {
    console.log(
      `\n${colors.yellow}⚠${colors.reset} ${colors.bright}${conflicts.totalConflicts} conflict(s) detected:${colors.reset}`
    );

    // List conflicting servers
    for (const conflict of conflicts.conflicts) {
      console.log(`  - ${colors.cyan}${conflict.name}${colors.reset} (${conflict.type})`);
    }

    // Check if a conflict strategy flag was provided
    const hasConflictFlag = options.overwrite || options.skip || options.merge || options.force;

    if (!hasConflictFlag) {
      const rl = createInterface({ input, output });

      console.log(`\nNo strategy flags provided. Choose per-conflict action:`);
      console.log(
        `  [s] skip (keep existing) · [o] overwrite (use incoming) · [m] merge (combine fields)`
      );

      for (const conflict of conflicts.conflicts) {
        while (true) {
          const answer = (
            await rl.question(`Action for ${conflict.name} (${conflict.type}) [s/o/m]: `)
          )
            .trim()
            .toLowerCase();
          if (answer === "o") {
            decisions.set(conflict.id, "overwrite");
            break;
          }
          if (answer === "m") {
            decisions.set(conflict.id, "merge");
            break;
          }
          if (answer === "s" || answer === "") {
            decisions.set(conflict.id, "skip");
            break;
          }
          console.log(`Please enter s, o, or m.`);
        }
      }

      rl.close();
    } else {
      // Apply the specified strategy to all conflicts
      let strategy: ConflictResolution = "skip"; // default

      if (options.overwrite || options.force) {
        strategy = "overwrite";
      } else if (options.merge) {
        strategy = "merge";
      }

      for (const conflict of conflicts.conflicts) {
        decisions.set(conflict.id, strategy);
      }

      // Show which conflicts will be handled
      console.log(
        `\n${colors.cyan}Applying "${strategy}" strategy to all conflicts${colors.reset}`
      );
    }
  }

  // Merge with decisions
  const mergeResult = importExportService.mergeServersWithDecisions(servers, decisions);

  console.log(`\n${colors.bright}Result:${colors.reset}`);
  if (mergeResult.added > 0) {
    console.log(`  ${colors.green}Added: ${mergeResult.added}${colors.reset}`);
  }
  if (mergeResult.updated > 0) {
    console.log(`  ${colors.yellow}Updated: ${mergeResult.updated}${colors.reset}`);
  }
  if (mergeResult.merged && mergeResult.merged > 0) {
    console.log(`  ${colors.cyan}Merged: ${mergeResult.merged}${colors.reset}`);
  }
  if (mergeResult.skipped > 0) {
    console.log(`  ${colors.gray}Skipped: ${mergeResult.skipped}${colors.reset}`);
  }
  for (const failure of mergeResult.errors || []) {
    console.error(failure.serverId + ": " + failure.error);
  }
  if (mergeResult.errors?.length) process.exitCode = 1;
}

/** Handle export command */
async function handleExport(options: { format?: string; output?: string }): Promise<void> {
  const importExportService = getImportExportService();
  const format = (options.format || "mcpsm") as ExportFormat;

  if (options.output) {
    // Export to file
    const filePath = path.resolve(options.output);
    const result = importExportService.exportToFile(filePath, format);

    if (result.success) {
      console.log(
        `${colors.green}✓${colors.reset} Exported to ${colors.bright}${filePath}${colors.reset}`
      );
    } else {
      console.error(`${colors.red}Error: ${result.error}${colors.reset}`);
      process.exit(1);
    }
  } else {
    // Export to stdout
    const exported = importExportService.export(format);
    outputJson(exported);
  }
}

export default registerImportExportCommands;
