/**
 * Auth commands - OAuth token management
 */

import { Command } from "commander";
import open from "open";
import { colors, c } from "../../shared/colors.js";
import { outputJson } from "../../shared/formatters.js";
import { getConfigService } from "../../services/config.service.js";
import { getAuthService } from "../../services/auth.service.js";
import { getTestingService } from "../../services/testing.service.js";
import type { RemoteServer, AuthStatus } from "../../types/index.js";

/** Register auth commands */
export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage OAuth authentication for MCP servers");

  // List auth status
  auth
    .command("status")
    .description("Show authentication status for all servers")
    .option("--json", "Output in JSON format")
    .action(async (options) => {
      const configService = getConfigService();
      const authService = getAuthService();

      const remoteServers = configService.getRemoteServers();
      const statuses: AuthStatus[] = [];

      for (const server of remoteServers) {
        let hasToken = authService.hasValidToken(server);
        let isExpired = authService.isTokenExpired(server);

        // Attempt refresh for expired-but-refreshable tokens before displaying status
        if (isExpired && authService.isRefreshable(server)) {
          const refreshed = await authService.ensureValidToken(server);
          if (refreshed) {
            hasToken = true;
            isExpired = false;
          }
        }

        const token = authService.getTokenForServer(server);

        statuses.push({
          serverId: server.id,
          serverName: server.name,
          hasToken,
          isOAuth: server.oauth?.enabled || false,
          isExpired,
          expiresAt: token?.expiresAt,
          tokenPreview: hasToken ? authService.getTokenPreview(server) || undefined : undefined,
          requiresAuth: server.oauth?.enabled && !hasToken,
        });
      }

      if (options.json) {
        outputJson(statuses);
        return;
      }

      console.log(`\n${colors.bright}${colors.cyan}Authentication Status${colors.reset}\n`);

      if (statuses.length === 0) {
        console.log(`${colors.gray}No remote servers configured.${colors.reset}`);
        return;
      }

      for (const status of statuses) {
        let statusIcon: string;
        let statusText: string;

        if (!status.isOAuth) {
          statusIcon = colors.gray + "○" + colors.reset;
          statusText = status.hasToken
            ? `${colors.gray}static token${colors.reset}`
            : `${colors.gray}no auth${colors.reset}`;
        } else if (status.hasToken && !status.isExpired) {
          statusIcon = c.checkmark;
          statusText = `${colors.green}authenticated${colors.reset}`;
          if (status.expiresAt) {
            const expiresIn = Math.round((status.expiresAt - Date.now()) / 1000 / 60);
            if (expiresIn < 60) {
              statusText += ` ${colors.yellow}(expires in ${expiresIn}m)${colors.reset}`;
            }
          }
        } else if (status.isExpired) {
          statusIcon = c.warning_icon;
          statusText = `${colors.yellow}token expired${colors.reset}`;
        } else {
          statusIcon = c.cross;
          statusText = `${colors.red}not authenticated${colors.reset}`;
        }

        console.log(
          `  ${statusIcon} ${colors.cyan}${status.serverName}${colors.reset}: ${statusText}`
        );
        if (status.tokenPreview) {
          console.log(`     ${colors.gray}Token: ${status.tokenPreview}${colors.reset}`);
        }
      }
    });

  // Login to a server
  auth
    .command("login <server>")
    .description("Authenticate with a remote MCP server using OAuth")
    .option("--no-browser", "Don't open browser automatically")
    .action(async (serverId: string, options) => {
      const configService = getConfigService();
      const authService = getAuthService();

      const serverResult = configService.findServer(serverId);
      if (!serverResult || serverResult.type !== "remote") {
        console.log(`${c.cross} Remote server '${serverId}' not found`);
        process.exit(1);
      }

      const server = serverResult.server as RemoteServer;

      // Check if OAuth is enabled
      if (!server.oauth?.enabled) {
        console.log(`${c.cross} OAuth is not enabled for server '${server.name}'`);
        console.log(
          `${colors.gray}Enable OAuth with: mcpsm server update ${server.id} --oauth${colors.reset}`
        );
        process.exit(1);
      }

      // Check if already authenticated (attempt refresh if expired)
      if (authService.hasValidToken(server)) {
        console.log(`${c.checkmark} Already authenticated with ${server.name}`);
        console.log(
          `${colors.gray}Use 'mcpsm auth logout ${server.id}' to remove the token.${colors.reset}`
        );
        return;
      }

      // Try refreshing before starting a full OAuth flow
      if (authService.isRefreshable(server)) {
        console.log(`${colors.gray}Token expired, attempting refresh...${colors.reset}`);
        const refreshed = await authService.ensureValidToken(server);
        if (refreshed) {
          console.log(`${c.checkmark} Token refreshed successfully for ${server.name}`);
          return;
        }
        console.log(`${colors.gray}Refresh failed, starting OAuth flow...${colors.reset}`);
      }

      console.log(`\n${colors.cyan}Starting OAuth flow for ${server.name}...${colors.reset}\n`);

      // Start the OAuth flow
      const flow = await authService.startOAuthFlow(server);
      if (!flow) {
        console.log(`${c.cross} Failed to start OAuth flow`);
        console.log(
          `${colors.gray}The server may not support OAuth or discovery failed.${colors.reset}`
        );
        process.exit(1);
      }

      console.log(`Authorization URL:`);
      console.log(`${colors.blue}${flow.authUrl}${colors.reset}\n`);

      // Open browser if requested
      if (options.browser !== false) {
        console.log(`Opening browser...`);
        try {
          await open(flow.authUrl);
        } catch {
          console.log(`${c.warning_icon} Failed to open browser automatically.`);
          console.log(`Please open the URL above in your browser.`);
        }
      } else {
        console.log(`Please open the URL above in your browser.`);
      }

      console.log(`\n${colors.yellow}Waiting for authentication...${colors.reset}`);
      console.log(`${colors.gray}(Press Ctrl+C to cancel)${colors.reset}\n`);

      // Wait for auth to complete
      const result = await authService.waitForAuth(flow.state);

      // Stop the callback server
      authService.stopCallbackServer();

      if (result.success) {
        console.log(`\n${c.checkmark} Successfully authenticated with ${server.name}`);

        if (result.expiresAt) {
          const expiresIn = Math.round((result.expiresAt - Date.now()) / 1000 / 60 / 60);
          console.log(`${colors.gray}Token expires in ${expiresIn} hours${colors.reset}`);
        }

        // Test the server to verify
        console.log(`\n${colors.gray}Verifying connection...${colors.reset}`);
        const testingService = getTestingService();
        const testResult = await testingService.testRemoteServer(server);

        if (testResult.success) {
          console.log(
            `${c.checkmark} Connection verified: ${testResult.toolCount} tools available`
          );
        } else {
          console.log(`${c.warning_icon} Connection test failed: ${testResult.error}`);
        }
      } else {
        console.log(`\n${c.cross} Authentication failed: ${result.error}`);
        process.exit(1);
      }
    });

  // Logout from a server
  auth
    .command("logout <server>")
    .description("Remove OAuth token for a server")
    .option("-f, --force", "Don't prompt for confirmation")
    .action(async (serverId: string, options) => {
      const configService = getConfigService();
      const authService = getAuthService();

      const serverResult = configService.findServer(serverId);
      if (!serverResult || serverResult.type !== "remote") {
        console.log(`${c.cross} Remote server '${serverId}' not found`);
        process.exit(1);
      }

      const server = serverResult.server as RemoteServer;

      // Any stored credential counts, even an expired access token: the refresh token
      // and client secret must still be removable.
      if (!authService.getStoredToken(server.id)) {
        console.log(`${colors.gray}No token stored for ${server.name}${colors.reset}`);
        return;
      }

      if (!options.force) {
        const readline = await import("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          rl.question(`Remove token for ${server.name}? (y/N) `, resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(`${colors.gray}Cancelled${colors.reset}`);
          return;
        }
      }

      authService.removeToken(server.id);
      console.log(`${c.checkmark} Token removed for ${server.name}`);
    });

  // Login to all servers that require auth
  auth
    .command("login-all")
    .description("Authenticate with all OAuth-enabled servers")
    .option("--no-browser", "Don't open browser automatically")
    .action(async (options) => {
      const configService = getConfigService();
      const authService = getAuthService();
      const testingService = getTestingService();

      const remoteServers = configService.getRemoteServers().filter((s) => s.oauth?.enabled);

      if (remoteServers.length === 0) {
        console.log(`${colors.gray}No OAuth-enabled servers configured.${colors.reset}`);
        return;
      }

      console.log(
        `\n${colors.bright}${colors.cyan}Authenticating ${remoteServers.length} server(s)${colors.reset}\n`
      );

      let authenticated = 0;
      let failed = 0;
      let skipped = 0;

      for (const server of remoteServers) {
        // Check if already authenticated
        if (authService.hasValidToken(server)) {
          console.log(`${c.checkmark} ${server.name}: already authenticated`);
          skipped++;
          continue;
        }

        console.log(`\n${colors.cyan}${server.name}${colors.reset}`);

        // Start the OAuth flow
        const flow = await authService.startOAuthFlow(server);
        if (!flow) {
          console.log(`  ${c.cross} Failed to start OAuth flow`);
          failed++;
          continue;
        }

        console.log(`  Authorization URL: ${colors.blue}${flow.authUrl}${colors.reset}`);

        // Open browser if requested
        if (options.browser !== false) {
          try {
            await open(flow.authUrl);
            console.log(`  ${colors.gray}Browser opened${colors.reset}`);
          } catch {
            console.log(`  ${c.warning_icon} Failed to open browser`);
          }
        }

        console.log(`  ${colors.yellow}Waiting for authentication...${colors.reset}`);

        // Wait for auth to complete
        const result = await authService.waitForAuth(flow.state);

        if (result.success) {
          console.log(`  ${c.checkmark} Authenticated`);

          // Test the connection
          const testResult = await testingService.testRemoteServer(server);
          if (testResult.success) {
            console.log(`  ${c.checkmark} ${testResult.toolCount} tools available`);
          }

          authenticated++;
        } else {
          console.log(`  ${c.cross} Failed: ${result.error}`);
          failed++;
        }
      }

      // Stop the callback server
      authService.stopCallbackServer();

      console.log(`\n${colors.bright}Summary:${colors.reset}`);
      if (authenticated > 0) {
        console.log(`  ${c.checkmark} ${authenticated} authenticated`);
      }
      if (skipped > 0) {
        console.log(`  ${colors.gray}${skipped} already authenticated${colors.reset}`);
      }
      if (failed > 0) {
        console.log(`  ${c.cross} ${failed} failed`);
      }
    });

  // Refresh token for a server
  auth
    .command("refresh <server>")
    .description("Refresh OAuth token for a server")
    .action(async (serverId: string) => {
      const configService = getConfigService();
      const authService = getAuthService();

      const serverResult = configService.findServer(serverId);
      if (!serverResult || serverResult.type !== "remote") {
        console.log(`${c.cross} Remote server '${serverId}' not found`);
        process.exit(1);
      }

      const server = serverResult.server as RemoteServer;
      const token = authService.getStoredToken(server.id);

      if (!token) {
        console.log(`${c.cross} No token stored for ${server.name}`);
        console.log(
          `${colors.gray}Use 'mcpsm auth login ${server.id}' to authenticate.${colors.reset}`
        );
        process.exit(1);
      }

      if (!token.refreshToken) {
        console.log(`${c.cross} No refresh token available for ${server.name}`);
        console.log(
          `${colors.gray}Use 'mcpsm auth login ${server.id}' to re-authenticate.${colors.reset}`
        );
        process.exit(1);
      }

      console.log(`Refreshing token for ${server.name}...`);

      const refreshed = await authService.refreshToken(server, token);

      if (refreshed) {
        console.log(`${c.checkmark} Token refreshed successfully`);

        if (refreshed.expiresAt) {
          const expiresIn = Math.round((refreshed.expiresAt - Date.now()) / 1000 / 60 / 60);
          console.log(`${colors.gray}Token expires in ${expiresIn} hours${colors.reset}`);
        }
      } else {
        console.log(`${c.cross} Failed to refresh token`);
        console.log(
          `${colors.gray}Use 'mcpsm auth login ${server.id}' to re-authenticate.${colors.reset}`
        );
        process.exit(1);
      }
    });
}
