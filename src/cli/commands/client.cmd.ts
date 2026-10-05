/**
 * Client commands - list, connect, disconnect, open
 */

import { Command } from "commander";
import { colors, c } from "../../shared/colors.js";
import { outputJson } from "../../shared/formatters.js";
import { ClientService, getClientService } from "../../services/client.service.js";
import { getProfileService } from "../../services/profile.service.js";
import { promptSelect } from "../../shared/prompts.js";
import type { ClientId } from "../../types/index.js";

type ClientScope = "global" | "project";

function serviceForScope(scope?: string) {
  if (scope && scope !== "global" && scope !== "project") {
    throw new Error("Scope must be global or project");
  }
  return scope === "project" ? new ClientService(process.cwd()) : getClientService();
}

/** Register client commands */
export function registerClientCommands(program: Command): void {
  const clients = program.command("clients").description("Manage MCP clients");

  // List clients (default)
  clients
    .command("list", { isDefault: true })
    .description("List detected MCP clients")
    .option("--json", "Output in JSON format")
    .option("--scope <scope>", "Configuration scope: global or project", "global")
    .action(async (options) => {
      const clientService = serviceForScope(options.scope);
      const detectedClients = clientService.detectClients();

      if (options.json) {
        outputJson(detectedClients);
        return;
      }

      console.log(`\n${colors.bright}${colors.cyan}MCP Clients${colors.reset}\n`);

      if (detectedClients.length === 0) {
        console.log(`${colors.gray}No clients detected.${colors.reset}`);
        return;
      }

      for (const client of detectedClients) {
        const statusIcon =
          client.status === "connected"
            ? `${colors.green}✔${colors.reset}`
            : client.status === "disconnected"
              ? `${colors.yellow}○${colors.reset}`
              : `${colors.gray}✗${colors.reset}`;

        const statusText =
          client.status === "connected"
            ? `${colors.green}connected${colors.reset}`
            : client.status === "disconnected"
              ? `${colors.yellow}disconnected${colors.reset}`
              : `${colors.gray}not installed${colors.reset}`;

        console.log(`  ${statusIcon} ${colors.cyan}${client.name}${colors.reset} [${client.id}]`);
        console.log(`    Status: ${statusText}`);
        console.log(
          `    Servers: ${client.serverCount} ${client.serverCount === 1 ? "server" : "servers"}`
        );
        if (client.mcpConfigPath) {
          console.log(`    ${colors.gray}${client.mcpConfigPath}${colors.reset}`);
        } else if (client.configPath) {
          console.log(`    ${colors.gray}${client.configPath}${colors.reset}`);
        }
        console.log();
      }
    });

  // Connect client
  clients
    .command("connect <client>")
    .description("Connect servers to a client")
    .option("-p, --profile <profileId>", "Connect using a specific profile")
    .option("--scope <scope>", "Configuration scope: global or project")
    .action(async (clientId: string, options: { profile?: string; scope?: string }) => {
      let clientService = serviceForScope(options.scope);
      const clientName = clientService.getClientName(clientId as ClientId);

      if (!clientService.clientExists(clientId)) {
        console.log(`${c.cross} Unknown client '${clientId}'`);
        console.log(`Available clients: ${clientService.getSupportedClients().join(", ")}`);
        process.exit(1);
      }

      if (!clientService.isClientInstalled(clientId as ClientId)) {
        console.log(`${c.cross} ${clientName} is not installed`);
        process.exit(1);
      }

      if (!options.scope && process.stdin.isTTY && clientService.supportsProjectConfig(clientId)) {
        const scope = await promptSelect<ClientScope>("Where should the client be configured?", [
          { label: "Global", value: "global" },
          { label: `Current folder (${process.cwd()})`, value: "project" },
        ]);
        if (!scope) return;
        clientService = serviceForScope(scope);
      }
      if (options.scope === "project" && !clientService.supportsProjectConfig(clientId)) {
        console.log(`${c.cross} ${clientName} does not support project configuration`);
        process.exit(1);
      }

      if (options.profile) {
        const profileService = getProfileService();
        if (!profileService.exists(options.profile)) {
          console.log(`${c.cross} Profile '${options.profile}' not found`);
          process.exit(1);
        }

        console.log(`Connecting profile '${options.profile}' to ${clientName}...`);
        const result = clientService.connectClient(clientId as ClientId, options.profile);

        if (result.success) {
          console.log(`${c.checkmark} Connected profile '${options.profile}' to ${clientName}`);
        } else {
          console.log(`${c.cross} Failed: ${result.error}`);
          process.exit(1);
        }
        return;
      }

      console.log(`Connecting all profiles to ${clientName}...`);
      const { succeeded, failed } = clientService.connectAllProfiles(clientId as ClientId);

      for (const id of succeeded) {
        console.log(`  ${c.checkmark} ${id}`);
      }
      for (const f of failed) {
        console.log(`  ${c.cross} ${f.id}: ${f.error}`);
      }

      if (succeeded.length === 0 && failed.length === 0) {
        console.log(
          `${colors.yellow}No profiles found. Create one first with: mcpsm profile create <name>${colors.reset}`
        );
      } else if (failed.length > 0) {
        console.log(`\n${c.cross} ${failed.length} profile(s) failed to connect`);
        process.exit(1);
      } else {
        console.log(
          `\n${c.checkmark} All ${succeeded.length} profile(s) connected to ${clientName}`
        );
      }
    });

  // Disconnect client
  clients
    .command("disconnect <client>")
    .description("Disconnect servers from a client")
    .option("-p, --profile <profileId>", "Disconnect a specific profile")
    .option("--scope <scope>", "Configuration scope: global or project", "global")
    .action(async (clientId: string, options: { profile?: string; scope?: string }) => {
      const clientService = serviceForScope(options.scope);
      const clientName = clientService.getClientName(clientId as ClientId);

      if (!clientService.clientExists(clientId)) {
        console.log(`${c.cross} Unknown client '${clientId}'`);
        console.log(`Available clients: ${clientService.getSupportedClients().join(", ")}`);
        process.exit(1);
      }

      if (!clientService.isClientInstalled(clientId as ClientId)) {
        console.log(`${c.cross} ${clientName} is not installed`);
        process.exit(1);
      }

      if (options.profile) {
        console.log(`Disconnecting profile '${options.profile}' from ${clientName}...`);
        const result = clientService.disconnectClient(clientId as ClientId, options.profile);

        if (result.success) {
          console.log(
            `${c.checkmark} Disconnected profile '${options.profile}' from ${clientName}`
          );
        } else {
          console.log(`${c.cross} Failed: ${result.error}`);
          process.exit(1);
        }
        return;
      }

      console.log(`Disconnecting all profiles from ${clientName}...`);
      const { failed } = clientService.disconnectAllProfiles(clientId as ClientId);

      if (failed.length > 0) {
        for (const f of failed) {
          console.log(`  ${c.cross} ${f.id}: ${f.error}`);
        }
        console.log(`\n${c.cross} ${failed.length} profile(s) failed to disconnect`);
        process.exit(1);
      } else {
        console.log(`${c.checkmark} Disconnected all profiles from ${clientName}`);
      }
    });

  // Open client config
  clients
    .command("open <client>")
    .description("Open client config in editor")
    .option("--scope <scope>", "Configuration scope: global or project", "global")
    .action(async (clientId: string, options: { scope: string }) => {
      const clientService = serviceForScope(options.scope);

      if (!clientService.clientExists(clientId)) {
        console.log(`${c.cross} Unknown client '${clientId}'`);
        console.log(`Available clients: ${clientService.getSupportedClients().join(", ")}`);
        process.exit(1);
      }

      const configPath = clientService.getClientConfigPath(clientId as ClientId);
      if (!configPath) {
        console.log(`${c.cross} Could not determine config path`);
        process.exit(1);
      }

      console.log(`Opening ${configPath}...`);
      const result = clientService.openClientConfig(clientId as ClientId);

      if (!result.success) {
        console.log(`${c.cross} ${result.error}`);
        console.log(`Config file: ${configPath}`);
        process.exit(1);
      }
    });
}
