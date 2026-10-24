/**
 * Settings commands - list, get, set, reset
 */

import { Command } from "commander";
import { colors, c } from "../../shared/colors.js";
import { outputJson } from "../../shared/formatters.js";
import { changeGatewayPort } from "../../services/gateway-port.service.js";
import { getSettingsService } from "../../services/settings.service.js";
import type { Settings } from "../../types/index.js";

/** Register settings commands */
export function registerSettingsCommands(program: Command): void {
  const settings = program.command("settings").description("Manage application settings");

  // List settings (default)
  settings
    .command("list", { isDefault: true })
    .description("List all settings")
    .option("--json", "Output in JSON format")
    .action(async (options) => {
      const settingsService = getSettingsService();
      const allSettings = settingsService.getAll();
      const info = settingsService.getInfo();

      if (options.json) {
        // Only output documented settings
        const documentedSettings: Record<string, unknown> = {};
        for (const key of Object.keys(info)) {
          documentedSettings[key] = allSettings[key as keyof Settings];
        }
        outputJson(documentedSettings);
        return;
      }

      console.log(`\n${colors.bright}${colors.cyan}Settings${colors.reset}\n`);

      // Only show documented settings
      for (const [key, settingInfo] of Object.entries(info)) {
        const value = allSettings[key as keyof Settings];
        const isDefault = settingsService.isDefault(key as keyof Settings);

        const valueStr =
          typeof value === "boolean"
            ? value
              ? `${colors.green}true${colors.reset}`
              : `${colors.red}false${colors.reset}`
            : `${colors.cyan}${value}${colors.reset}`;

        const defaultMark = isDefault ? ` ${colors.gray}(default)${colors.reset}` : "";

        console.log(`  ${colors.bright}${key}${colors.reset}: ${valueStr}${defaultMark}`);
        if (settingInfo.description) {
          console.log(`    ${colors.gray}${settingInfo.description}${colors.reset}`);
        }
      }

      console.log(
        `\n${colors.gray}Use 'mcpsm settings set <key> <value>' to change a setting${colors.reset}`
      );
    });

  // Get setting
  settings
    .command("get <key>")
    .description("Get a setting value")
    .option("--json", "Output in JSON format")
    .action(async (key: string, options) => {
      const settingsService = getSettingsService();
      const keys = settingsService.getKeys();

      if (!keys.includes(key as keyof Settings)) {
        console.log(`${c.cross} Unknown setting: ${key}`);
        console.log(`Available settings: ${keys.join(", ")}`);
        process.exit(1);
      }

      const value = settingsService.get(key as keyof Settings);

      if (options.json) {
        outputJson({ [key]: value });
      } else {
        console.log(value);
      }
    });

  // Set setting
  settings
    .command("set <key> <value>")
    .description("Set a setting value")
    .action(async (key: string, value: string) => {
      const settingsService = getSettingsService();
      const keys = settingsService.getKeys();

      if (!keys.includes(key as keyof Settings)) {
        console.log(`${c.cross} Unknown setting: ${key}`);
        console.log(`Available settings: ${keys.join(", ")}`);
        process.exit(1);
      }

      if (key === "port") {
        const result = await changeGatewayPort(Number(value));
        if (!result.success) {
          console.error("Port is " + result.port + ": " + result.error);
          process.exitCode = 1;
          return;
        }
        console.log("port = " + result.port);
        return;
      }

      const result = settingsService.set(key as keyof Settings, value);

      if (result.success) {
        console.log(`${c.checkmark} ${key} = ${result.value}`);
        if ("warnings" in result && Array.isArray(result.warnings)) {
          for (const warning of result.warnings || [])
            console.log(`${colors.yellow}${warning}${colors.reset}`);
        }
      } else {
        console.log(`${c.cross} ${result.error}`);
        process.exit(1);
      }
    });

  // Reset settings
  settings
    .command("reset")
    .description("Reset all settings to defaults")
    .option("-y, --yes", "Confirm reset (required for non-interactive mode)")
    .action(async (options) => {
      const isInteractive = process.stdin.isTTY;
      if (!options.yes && !isInteractive) {
        console.log(`${c.cross} Confirmation required in non-interactive mode`);
        console.log(`${colors.gray}Please run with --yes or -y to confirm reset${colors.reset}`);
        console.log(`${colors.gray}Example: mcpsm settings reset --yes${colors.reset}`);
        process.exit(1);
      }

      const settingsService = getSettingsService();
      const result = await changeGatewayPort(Number(settingsService.getInfo().port.default));
      if (!result.success) {
        console.error("Port is " + result.port + ": " + result.error);
        process.exitCode = 1;
        return;
      }
      try {
        settingsService.reset();
        console.log(`${c.checkmark} Settings reset to defaults`);
      } catch (error) {
        console.error(
          `Port saved, but settings could not be reset: ${error instanceof Error ? error.message : String(error)}`
        );
        process.exitCode = 1;
      }
    });
}
