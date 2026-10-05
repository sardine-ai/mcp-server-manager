/**
 * Server commands - list, add, remove, edit, test
 */

import { Command } from "commander";
import { colors, c } from "../../shared/colors.js";
import { outputJson } from "../../shared/formatters.js";
import { parseEnvInput, normalizeEnv } from "../../shared/env.js";
import { getConfigService } from "../../services/config.service.js";
import { getTestingService } from "../../services/testing.service.js";
import { getAuthService } from "../../services/auth.service.js";
import type { LocalServer, RemoteServer, TransportType, OAuthConfig } from "../../types/index.js";
import { redactServerForOutput } from "../../shared/redaction.js";

function parseHeaderOptions(
  input: unknown
): { success: true; data?: Record<string, string> } | { success: false; error: string } {
  const parsed = parseEnvInput(input as string[] | string | undefined);
  if (!parsed.success) {
    return { success: false, error: parsed.error || "Invalid header input" };
  }

  return { success: true, data: normalizeEnv(parsed.data) };
}

/** Register server commands */
export function registerServerCommands(program: Command): void {
  // List servers
  program
    .command("list")
    .alias("ls")
    .description("List all configured servers")
    .option("--json", "Output in JSON format")
    .option("--tokens", "Show token counts per server")
    .action(async (options) => {
      const showJson = options.json ?? program.opts().json ?? false;
      const configService = getConfigService();
      const servers = configService.getLocalServers();
      const remoteServers = configService.getRemoteServers();
      const toolFilters = configService.getToolFilters();

      if (showJson) {
        outputJson({
          servers: servers.map((s) => {
            const redacted = redactServerForOutput(s) as LocalServer;
            return {
              ...redacted,
              type: "stdio",
              toolCount: toolFilters[s.id]?.allTools?.length || 0,
              tokens: toolFilters[s.id]?.totalTokens || 0,
            };
          }),
          remoteServers: remoteServers.map((s) => {
            const redacted = redactServerForOutput(s) as RemoteServer;
            return {
              ...redacted,
              toolCount: toolFilters[`remote:${s.id}`]?.allTools?.length || 0,
              tokens: toolFilters[`remote:${s.id}`]?.totalTokens || 0,
            };
          }),
        });
        return;
      }

      console.log(`\n${colors.bright}${colors.cyan}MCP Servers${colors.reset}\n`);

      if (servers.length === 0 && remoteServers.length === 0) {
        console.log(`${colors.gray}No servers configured.${colors.reset}`);
        console.log(`${colors.gray}Use 'mcpsm add' to add a new server.${colors.reset}`);
        return;
      }

      if (servers.length > 0) {
        console.log(`${colors.bright}Local Servers (STDIO):${colors.reset}`);
        for (const server of servers) {
          const filter = toolFilters[server.id];
          const toolCount = filter?.allTools?.length || 0;
          const tokens =
            options.tokens && filter?.totalTokens
              ? ` · ${colors.magenta}${filter.totalTokens} tokens${colors.reset}`
              : "";

          console.log(
            `  ${colors.cyan}${server.name}${colors.reset} [${server.id}] · ${toolCount} tools${tokens}`
          );
          console.log(
            `    ${colors.gray}${server.command} ${server.args.join(" ")}${colors.reset}`
          );
        }
      }

      if (remoteServers.length > 0) {
        if (servers.length > 0) console.log();
        const authService = getAuthService();
        console.log(`${colors.bright}Remote Servers:${colors.reset}`);
        for (const server of remoteServers) {
          const filter = toolFilters[`remote:${server.id}`];
          const toolCount = filter?.allTools?.length || 0;
          const tokens =
            options.tokens && filter?.totalTokens
              ? ` · ${colors.magenta}${filter.totalTokens} tokens${colors.reset}`
              : "";

          // OAuth status
          let authStatus = "";
          if (server.oauth?.enabled) {
            if (authService.hasValidToken(server.id)) {
              authStatus = ` · ${colors.green}OAuth${colors.reset}`;
            } else if (authService.isRefreshable(server.id)) {
              const token = await authService.getValidToken(server);
              if (token) {
                authStatus = ` · ${colors.green}OAuth${colors.reset}`;
              } else {
                authStatus = ` · ${colors.red}OAuth (refresh failed)${colors.reset}`;
              }
            } else {
              authStatus = ` · ${colors.red}OAuth (not auth'd)${colors.reset}`;
            }
          } else if (server.bearerToken) {
            authStatus = ` · ${colors.gray}token${colors.reset}`;
          }

          console.log(
            `  ${colors.cyan}${server.name}${colors.reset} [${server.id}] (${server.type}) · ${toolCount} tools${tokens}${authStatus}`
          );
          console.log(`    ${colors.gray}${server.url}${colors.reset}`);
        }
      }
    });

  // Add server
  program
    .command("add <name>")
    .description("Add a new MCP server")
    .option("-t, --type <type>", "Server type: stdio, http, sse")
    .option("-c, --command <command>", "Command to run (for stdio)")
    .option("-a, --args <args>", "Command arguments (for stdio)")
    .option(
      "-e, --env <env...>",
      "Environment variable(s) for stdio servers (KEY=VALUE, space/comma separated)"
    )
    .option("-u, --url <url>", "Server URL (for http/sse)")
    .option("--token <token>", "Bearer token (for http/sse)")
    .option(
      "--header <header...>",
      "HTTP header(s) for http/sse servers (KEY=VALUE, space/comma separated)"
    )
    .option("--oauth", "Enable OAuth authentication (for http/sse)")
    .option("--client-id <id>", "OAuth client ID (optional)")
    .option("--client-secret <secret>", "OAuth client secret (optional)")
    .option("--scopes <scopes>", "OAuth scopes (comma-separated)")
    .option("--auth-server <url>", "OAuth authorization server URL (optional)")
    .option("--test", "Test the server after adding")
    .action(async (name, options) => {
      const configService = getConfigService();

      const serverId = configService.generateServerId(name);

      // Determine type
      const serverType: "stdio" | "http" | "sse" | undefined =
        options.type === "stdio" || options.type === "http" || options.type === "sse"
          ? options.type
          : undefined;
      if (!serverType) {
        console.log(`${c.cross} Server type is required`);
        console.log(
          `${colors.gray}Use: mcpsm add <name> -t <stdio|http|sse> [options]${colors.reset}`
        );
        process.exit(1);
      }

      if (serverType === "stdio") {
        // Local server
        const command = options.command;
        if (!command) {
          console.log(`${c.cross} Command is required for stdio servers`);
          console.log(
            `${colors.gray}Use: mcpsm add <name> -t stdio -c <command> [-a <args>]${colors.reset}`
          );
          process.exit(1);
        }

        let args: string[] = [];
        if (options.args) {
          args = options.args.split(/[\s,]+/).filter(Boolean);
        }

        const parsedEnv = parseEnvInput(options.env);
        if (!parsedEnv.success) {
          console.log(`${c.cross} ${parsedEnv.error}`);
          process.exit(1);
        }
        const env = normalizeEnv(parsedEnv.data);

        const server: LocalServer = {
          id: serverId,
          name,
          command,
          args,
          ...(env ? { env } : {}),
        };

        const result = configService.addLocalServer(server);
        if (!result.success) {
          console.log(`${c.cross} ${result.error}`);
          process.exit(1);
        }

        console.log(`${c.checkmark} Server '${name}' added successfully!`);

        // Test if --test flag provided
        if (options.test) {
          process.stdout.write(`  Testing ${colors.cyan}${name}${colors.reset}... `);
          const testingService = getTestingService();
          const testResult = await testingService.testLocalServer(server);
          if (testResult.success) {
            console.log(`${c.checkmark} OK (${testResult.toolCount} tools)`);
          } else {
            console.log(`${c.cross} FAILED - ${testResult.error}`);
          }
        }
      } else {
        // Remote server
        if (options.env) {
          console.log(
            `${colors.yellow}Warning:${colors.reset} --env is only used for stdio servers and will be ignored for remote servers.`
          );
        }

        const url = options.url;
        if (!url) {
          console.log(`${c.cross} URL is required for remote servers`);
          console.log(
            `${colors.gray}Use: mcpsm add <name> -t <http|sse> -u <url> [--token <token>] [--oauth]${colors.reset}`
          );
          process.exit(1);
        }

        const server: RemoteServer = {
          id: serverId,
          name,
          type: serverType as TransportType,
          url,
        };

        if (options.token) {
          server.bearerToken = options.token;
        }

        if (options.header !== undefined) {
          const parsedHeaders = parseHeaderOptions(options.header);
          if (!parsedHeaders.success) {
            console.log(`${c.cross} ${parsedHeaders.error}`);
            process.exit(1);
          }
          if (parsedHeaders.data && Object.keys(parsedHeaders.data).length > 0) {
            server.headers = parsedHeaders.data;
          }
        }

        // Configure OAuth if enabled
        if (options.oauth) {
          const oauthConfig: OAuthConfig = {
            enabled: true,
          };

          if (options.clientId) {
            oauthConfig.clientId = options.clientId;
          }
          if (options.clientSecret) {
            oauthConfig.clientSecret = options.clientSecret;
          }
          if (options.scopes) {
            oauthConfig.scopes = options.scopes.split(",").map((s: string) => s.trim());
          }
          if (options.authServer) {
            oauthConfig.authServerUrl = options.authServer;
          }

          server.oauth = oauthConfig;
        }

        const result = configService.addRemoteServer(server);
        if (!result.success) {
          console.log(`${c.cross} ${result.error}`);
          process.exit(1);
        }

        console.log(`${c.checkmark} Server '${name}' added successfully!`);

        // Test if --test flag provided
        if (options.test) {
          process.stdout.write(`  Testing ${colors.cyan}${name}${colors.reset}... `);
          const testingService = getTestingService();

          // First quick test without auth
          let testResult = await testingService.testRemoteServer(server, true);

          if (testResult.success) {
            console.log(`${c.checkmark} OK (${testResult.toolCount} tools)`);
          } else if (testResult.requiresAuth) {
            // Server requires authentication - offer to authenticate
            console.log(`${colors.yellow}requires authentication${colors.reset}`);

            // Auto-enable OAuth if not enabled
            if (!server.oauth?.enabled) {
              configService.updateRemoteServer(serverId, { oauth: { enabled: true } });
              server.oauth = { enabled: true };
              console.log(`  ${colors.gray}OAuth auto-enabled for this server${colors.reset}`);
            }

            // Import open for browser
            const open = (await import("open")).default;
            const authService = getAuthService();

            // Start OAuth flow
            const flow = await authService.startOAuthFlow(server, testResult.authRequirements);
            if (flow) {
              console.log(`\n  ${colors.cyan}Opening browser for authentication...${colors.reset}`);
              try {
                await open(flow.authUrl);
              } catch {
                console.log(
                  `  ${colors.yellow}Could not open browser automatically.${colors.reset}`
                );
                console.log(`  Please open: ${colors.blue}${flow.authUrl}${colors.reset}`);
              }

              console.log(`  ${colors.yellow}Waiting for authentication...${colors.reset}`);

              // Wait for auth
              const authResult = await authService.waitForAuth(flow.state);
              authService.stopCallbackServer();

              if (authResult.success) {
                console.log(`  ${c.checkmark} Authenticated successfully`);

                // Re-test
                process.stdout.write(`  Re-testing... `);
                testResult = await testingService.testRemoteServer(server);
                if (testResult.success) {
                  console.log(`${c.checkmark} OK (${testResult.toolCount} tools)`);
                } else {
                  console.log(`${c.cross} FAILED - ${testResult.error}`);
                }
              } else {
                console.log(`  ${c.cross} Authentication failed: ${authResult.error}`);
              }
            } else {
              console.log(`  ${c.cross} Could not start OAuth flow`);
              console.log(`  ${colors.gray}Server may not support OAuth discovery${colors.reset}`);
            }
          } else {
            console.log(`${c.cross} FAILED - ${testResult.error}`);
          }
        } else if (server.oauth?.enabled) {
          console.log(
            `${colors.gray}OAuth enabled. Run 'mcpsm auth login ${serverId}' to authenticate.${colors.reset}`
          );
        }
      }
    });

  // Remove server
  program
    .command("remove <nameOrId>")
    .aliases(["rm", "delete"])
    .description("Remove a server")
    .option("-y, --yes", "Confirm deletion (required for non-interactive mode)")
    .action(async (nameOrId, options) => {
      const isInteractive = process.stdin.isTTY;
      if (!options.yes && !isInteractive) {
        console.log(`${c.cross} Confirmation required in non-interactive mode`);
        console.log(`${colors.gray}Please run with --yes or -y to confirm deletion${colors.reset}`);
        console.log(`${colors.gray}Example: mcpsm remove ${nameOrId} --yes${colors.reset}`);
        process.exit(1);
      }

      const configService = getConfigService();
      const result = configService.findServer(nameOrId);

      if (!result) {
        console.log(`${c.cross} Server '${nameOrId}' not found`);
        process.exit(1);
      }

      const { server } = result;

      const deleteResult = configService.deleteServer(server.id);
      if (deleteResult.success) {
        console.log(`${c.checkmark} Server '${server.name}' deleted`);
      } else {
        console.log(`${c.cross} ${deleteResult.error}`);
        process.exit(1);
      }
    });

  // Edit server
  program
    .command("edit <nameOrId>")
    .description("Edit a server")
    .option("-n, --name <name>", "New name")
    .option("-u, --url <url>", "New URL (remote only)")
    .option("-t, --type <type>", "New type: http or sse (remote only)")
    .option("--token <token>", "New bearer token (remote only)")
    .option(
      "--header <header...>",
      "HTTP header(s) to merge into remote server headers (KEY=VALUE, space/comma separated)"
    )
    .option("--oauth", "Enable OAuth authentication (remote only)")
    .option("--no-oauth", "Disable OAuth authentication (remote only)")
    .option("--client-id <id>", "OAuth client ID (remote only)")
    .option("--client-secret <secret>", "OAuth client secret (remote only)")
    .option("--scopes <scopes>", "OAuth scopes (comma-separated, remote only)")
    .option("--auth-server <url>", "OAuth authorization server URL (remote only)")
    .option("-c, --command <command>", "New command (local only)")
    .option("-a, --args <args>", "New arguments (local only)")
    .option(
      "-e, --env <env...>",
      "Environment variable(s) for stdio servers (KEY=VALUE, space/comma separated)"
    )
    .action(async (nameOrId, options) => {
      const configService = getConfigService();
      const result = configService.findServer(nameOrId);

      if (!result) {
        console.log(`${c.cross} Server '${nameOrId}' not found`);
        process.exit(1);
      }

      const { server, type } = result;

      if (type === "local") {
        const updates: Partial<LocalServer> = {};
        if (options.name) updates.name = options.name;
        if (options.command) updates.command = options.command;
        if (options.args) updates.args = options.args.split(/[\s,]+/).filter(Boolean);
        if (options.env !== undefined) {
          const parsedEnv = parseEnvInput(options.env);
          if (!parsedEnv.success) {
            console.log(`${c.cross} ${parsedEnv.error}`);
            process.exit(1);
          }
          const env = normalizeEnv(parsedEnv.data);
          updates.env = env && Object.keys(env).length > 0 ? env : undefined;
        }

        if (Object.keys(updates).length === 0) {
          console.log(`${colors.yellow}No changes specified${colors.reset}`);
          return;
        }

        const updateResult = configService.updateLocalServer(server.id, updates);
        if (updateResult.success) {
          console.log(`${c.checkmark} Server '${server.name}' updated`);
        } else {
          console.log(`${c.cross} ${updateResult.error}`);
          process.exit(1);
        }
      } else {
        const remoteServer = server as RemoteServer;
        const updates: Partial<RemoteServer> = {};
        if (options.name) updates.name = options.name;
        if (options.url) updates.url = options.url;
        if (options.type) updates.type = options.type as TransportType;
        if (options.token) updates.bearerToken = options.token;
        if (options.header !== undefined) {
          const parsedHeaders = parseHeaderOptions(options.header);
          if (!parsedHeaders.success) {
            console.log(`${c.cross} ${parsedHeaders.error}`);
            process.exit(1);
          }
          updates.headers = {
            ...(remoteServer.headers || {}),
            ...(parsedHeaders.data || {}),
          };
        }

        // Handle OAuth configuration
        if (options.oauth === true) {
          // Enable OAuth
          const oauthConfig: OAuthConfig = {
            enabled: true,
            ...(remoteServer.oauth || {}),
          };

          if (options.clientId) oauthConfig.clientId = options.clientId;
          if (options.clientSecret) oauthConfig.clientSecret = options.clientSecret;
          if (options.scopes)
            oauthConfig.scopes = options.scopes.split(",").map((s: string) => s.trim());
          if (options.authServer) oauthConfig.authServerUrl = options.authServer;

          updates.oauth = oauthConfig;
        } else if (options.oauth === false) {
          // Disable OAuth
          updates.oauth = { enabled: false };
        } else if (remoteServer.oauth?.enabled) {
          // Update existing OAuth config
          const oauthConfig: OAuthConfig = { ...remoteServer.oauth };

          if (options.clientId) oauthConfig.clientId = options.clientId;
          if (options.clientSecret) oauthConfig.clientSecret = options.clientSecret;
          if (options.scopes)
            oauthConfig.scopes = options.scopes.split(",").map((s: string) => s.trim());
          if (options.authServer) oauthConfig.authServerUrl = options.authServer;

          if (options.clientId || options.clientSecret || options.scopes || options.authServer) {
            updates.oauth = oauthConfig;
          }
        }

        if (Object.keys(updates).length === 0) {
          console.log(`${colors.yellow}No changes specified${colors.reset}`);
          return;
        }

        const updateResult = configService.updateRemoteServer(server.id, updates);
        if (updateResult.success) {
          console.log(`${c.checkmark} Server '${server.name}' updated`);

          if (updates.oauth?.enabled === true && !remoteServer.oauth?.enabled) {
            console.log(
              `${colors.gray}OAuth enabled. Run 'mcpsm auth login ${server.id}' to authenticate.${colors.reset}`
            );
          } else if (updates.oauth?.enabled === false && remoteServer.oauth?.enabled) {
            // Clear any stored tokens when OAuth is disabled
            const authService = getAuthService();
            authService.removeToken(server.id);
            console.log(`${colors.gray}OAuth disabled. Token removed.${colors.reset}`);
          }
        } else {
          console.log(`${c.cross} ${updateResult.error}`);
          process.exit(1);
        }
      }
    });

  // Test server
  program
    .command("test [nameOrId]")
    .description("Test a server or all servers")
    .option("--json", "Output in JSON format")
    .option("--auth", "Automatically authenticate if needed")
    .action(async (nameOrId, options) => {
      const configService = getConfigService();
      const testingService = getTestingService();

      // Helper to handle OAuth for a remote server
      const handleOAuth = async (server: RemoteServer): Promise<boolean> => {
        const open = (await import("open")).default;
        const authService = getAuthService();

        // Auto-enable OAuth if not enabled
        if (!server.oauth?.enabled) {
          configService.updateRemoteServer(server.id, { oauth: { enabled: true } });
          server.oauth = { enabled: true };
        }

        const flow = await authService.startOAuthFlow(server);
        if (!flow) {
          console.log(`\n  ${c.cross} Could not start OAuth flow for ${server.name}`);
          return false;
        }

        console.log(`\n  ${colors.cyan}Opening browser for ${server.name}...${colors.reset}`);
        try {
          await open(flow.authUrl);
        } catch {
          console.log(`  ${colors.yellow}Could not open browser. Please open:${colors.reset}`);
          console.log(`  ${colors.blue}${flow.authUrl}${colors.reset}`);
        }

        console.log(`  ${colors.yellow}Waiting for authentication...${colors.reset}`);
        const authResult = await authService.waitForAuth(flow.state);
        authService.stopCallbackServer();

        if (authResult.success) {
          console.log(`  ${c.checkmark} ${server.name} authenticated`);
          return true;
        } else {
          console.log(`  ${c.cross} Authentication failed: ${authResult.error}`);
          return false;
        }
      };

      if (nameOrId) {
        // Test specific server
        const result = configService.findServer(nameOrId);
        if (!result) {
          console.log(`${c.cross} Server '${nameOrId}' not found`);
          process.exit(1);
        }

        const { server, type } = result;
        process.stdout.write(`Testing ${colors.cyan}${server.name}${colors.reset}... `);

        let testResult = await testingService.testServer(server, type);

        // Handle OAuth if needed and --auth flag provided
        if (!testResult.success && testResult.requiresAuth && options.auth && type === "remote") {
          console.log(`${colors.yellow}requires authentication${colors.reset}`);
          const authenticated = await handleOAuth(server as RemoteServer);
          if (authenticated) {
            process.stdout.write(`  Re-testing ${colors.cyan}${server.name}${colors.reset}... `);
            testResult = await testingService.testServer(server, type);
          }
        }

        if (options.json) {
          outputJson({ server: server.name, ...testResult });
        } else if (testResult.success) {
          console.log(`${c.checkmark} OK (${testResult.toolCount} tools)`);
        } else if (testResult.requiresAuth && !options.auth) {
          console.log(`${c.cross} FAILED - ${testResult.error}`);
          console.log(
            `  ${colors.gray}Run with --auth to authenticate automatically${colors.reset}`
          );
        } else {
          console.log(`${c.cross} FAILED - ${testResult.error}`);
        }
      } else {
        // Test all servers
        console.log(`\n${colors.bright}${colors.cyan}Testing All Servers${colors.reset}\n`);

        const results = await testingService.testAllServers();

        // Collect servers that need auth
        const needsAuth: Array<{ server: RemoteServer; index: number }> = [];

        if (options.json) {
          outputJson(
            results.map((r) => ({
              server: r.server.name,
              type: r.type,
              ...r.result,
            }))
          );
          return;
        }

        for (let i = 0; i < results.length; i++) {
          const { server, type, result } = results[i];
          const typeLabel = type === "local" ? "" : ` (${(server as RemoteServer).type})`;

          if (result.success) {
            console.log(
              `  ${c.checkmark} ${colors.cyan}${server.name}${colors.reset}${typeLabel} - ${result.toolCount} tools`
            );
          } else if (result.requiresAuth) {
            console.log(
              `  ${colors.yellow}○${colors.reset} ${colors.cyan}${server.name}${colors.reset}${typeLabel} - ${colors.yellow}requires auth${colors.reset}`
            );
            if (type === "remote") {
              needsAuth.push({ server: server as RemoteServer, index: i });
            }
          } else {
            console.log(
              `  ${c.cross} ${colors.cyan}${server.name}${colors.reset}${typeLabel} - ${result.error}`
            );
          }
        }

        // Handle OAuth for servers that need it
        if (needsAuth.length > 0 && options.auth) {
          console.log(
            `\n${colors.bright}Authenticating ${needsAuth.length} server(s)...${colors.reset}`
          );

          for (const { server, index } of needsAuth) {
            const authenticated = await handleOAuth(server);
            if (authenticated) {
              // Re-test the server
              const newResult = await testingService.testRemoteServer(server);
              results[index].result = newResult;
            }
          }

          // Print updated results for re-tested servers
          console.log(`\n${colors.bright}Updated Results:${colors.reset}`);
          for (const { server, index } of needsAuth) {
            const result = results[index].result;
            if (result.success) {
              console.log(
                `  ${c.checkmark} ${colors.cyan}${server.name}${colors.reset} - ${result.toolCount} tools`
              );
            } else {
              console.log(
                `  ${c.cross} ${colors.cyan}${server.name}${colors.reset} - ${result.error}`
              );
            }
          }
        } else if (needsAuth.length > 0 && !options.auth) {
          console.log(
            `\n${colors.gray}${needsAuth.length} server(s) need authentication. Run with --auth to authenticate.${colors.reset}`
          );
        }

        const passed = results.filter((r) => r.result.success).length;
        const failed = results.filter((r) => !r.result.success && !r.result.requiresAuth).length;
        const authRequired = results.filter(
          (r) => r.result.requiresAuth && !r.result.success
        ).length;
        const totalTools = results.reduce((sum, r) => sum + (r.result.toolCount || 0), 0);

        console.log(`\n${colors.bright}Summary:${colors.reset}`);
        console.log(`  ${colors.green}Passed: ${passed}${colors.reset}`);
        if (failed > 0) {
          console.log(`  ${colors.red}Failed: ${failed}${colors.reset}`);
        }
        if (authRequired > 0) {
          console.log(`  ${colors.yellow}Needs auth: ${authRequired}${colors.reset}`);
        }
        console.log(`  ${colors.magenta}Total tools: ${totalTools}${colors.reset}`);
      }
    });
}
