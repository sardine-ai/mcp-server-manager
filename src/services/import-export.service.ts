/**
 * Import/Export service - handles server configuration import and export
 */

import fs from "fs";
import path from "path";
import { getConfigService } from "./config.service.js";
import { getClientService } from "./client.service.js";
import type { LocalServer, RemoteServer, Result, TransportType, ClientId } from "../types/index.js";
import type {
  ServerConflict,
  FieldDifference,
  ConflictsDetectionResult,
  ConflictResolution,
  ImportedServer,
  MergeResults,
} from "../types/index.js";

/** Parsed import result */
export interface ParsedImport {
  format: string;
  servers: ImportedServer[];
}

/** Export format */
export type ExportFormat = "mcpsm" | "json";

/** MCP Standard JSON format (compatible with Claude Desktop, Cursor, Windsurf, VS Code, etc.) */
interface ClaudeFormat {
  mcpServers: Record<
    string,
    {
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      url?: string;
      serverUrl?: string;
      type?: string;
      headers?: Record<string, string>;
      bearerToken?: string;
    }
  >;
}

/** Zed format */
interface ZedFormat {
  context_servers: Record<
    string,
    {
      url?: string;
      headers?: Record<string, string>;
      settings?: Record<string, unknown>;
    }
  >;
}

/** MCPSM format */
interface McpsmFormat {
  servers: LocalServer[];
  remoteServers: RemoteServer[];
  port?: number;
}

function normalizeHeaders(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter((entry): entry is [string, string | number | boolean] =>
        ["string", "number", "boolean"].includes(typeof entry[1])
      )
      .map(([key, value]) => [key, String(value)])
  );

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Import/Export service class */
export class ImportExportService {
  /** Parse import data and auto-detect format */
  parseImportData(data: unknown): ParsedImport | null {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const serversValue = (data as McpsmFormat).servers;
    const remoteServersValue = (data as McpsmFormat).remoteServers;
    const hasMcpsmShape = Array.isArray(serversValue) || Array.isArray(remoteServersValue);

    // MCPSM format: { servers: [], remoteServers: [] }
    if (hasMcpsmShape) {
      return {
        format: "mcpsm",
        servers: this.parseMcpsmFormat(data as McpsmFormat),
      };
    }

    // VS Code format: { servers: { id: { type, command, args } } }
    if ("servers" in data && serversValue && !Array.isArray(serversValue)) {
      const serversRecord = (serversValue ?? {}) as ClaudeFormat["mcpServers"];
      if (serversRecord && typeof serversRecord === "object") {
        return {
          format: "vscode",
          servers: this.parseClaudeFormat({ mcpServers: serversRecord } as ClaudeFormat),
        };
      }
    }

    // Zed format: { context_servers: { id: { url, headers, settings } } }
    const contextServers = (data as ZedFormat).context_servers;
    if (
      "context_servers" in data &&
      contextServers &&
      typeof contextServers === "object" &&
      !Array.isArray(contextServers)
    ) {
      return {
        format: "zed",
        servers: this.parseZedFormat(data as ZedFormat),
      };
    }

    // Claude Desktop format: { mcpServers: { id: { command, args } } }
    if ("mcpServers" in data && typeof (data as ClaudeFormat).mcpServers === "object") {
      return {
        format: "claude",
        servers: this.parseClaudeFormat(data as ClaudeFormat),
      };
    }

    // Simple array format: [{ id, command, args }]
    if (Array.isArray(data)) {
      return {
        format: "array",
        servers: this.parseArrayFormat(data),
      };
    }

    return null;
  }

  /** Parse Claude Desktop format */
  private parseClaudeFormat(data: ClaudeFormat): ImportedServer[] {
    const servers: ImportedServer[] = [];

    for (const [id, server] of Object.entries(data.mcpServers)) {
      if (server.command) {
        servers.push({
          id,
          name: id,
          serverType: "local",
          command: server.command,
          args: server.args || [],
          env: server.env,
        });
      } else if (server.url || server.serverUrl) {
        servers.push({
          id,
          name: id,
          serverType: "remote",
          url: server.url || server.serverUrl,
          type: (server.type as TransportType) || "http",
          headers: normalizeHeaders(server.headers),
          bearerToken: server.bearerToken,
        });
      }
    }

    return servers;
  }

  /** Parse MCPSM format */
  private parseMcpsmFormat(data: McpsmFormat): ImportedServer[] {
    const servers: ImportedServer[] = [];

    if (data.servers) {
      for (const server of data.servers) {
        servers.push({
          id: server.id,
          name: server.name,
          serverType: "local",
          command: server.command,
          args: server.args,
          env: server.env,
        });
      }
    }

    if (data.remoteServers) {
      for (const server of data.remoteServers) {
        servers.push({
          id: server.id,
          name: server.name,
          serverType: "remote",
          url: server.url,
          type: server.type,
          headers: normalizeHeaders(server.headers),
          bearerToken: server.bearerToken,
        });
      }
    }

    return servers;
  }

  /** Parse Zed format */
  private parseZedFormat(data: ZedFormat): ImportedServer[] {
    const servers: ImportedServer[] = [];

    for (const [id, server] of Object.entries(data.context_servers || {})) {
      if (!server.url) continue;

      const type: TransportType = server.url.includes("/sse") ? "sse" : "http";
      servers.push({
        id,
        name: id,
        serverType: "remote",
        url: server.url,
        type,
        headers: normalizeHeaders(server.headers),
      });
    }

    return servers;
  }

  /** Parse array format */
  private parseArrayFormat(data: unknown[]): ImportedServer[] {
    return data.map((item) => {
      const server = item as Record<string, unknown>;
      const isRemote = "url" in server;

      return {
        id: String(server.id || ""),
        name: String(server.name || server.id || ""),
        serverType: isRemote ? "remote" : "local",
        command: server.command ? String(server.command) : undefined,
        args: Array.isArray(server.args) ? server.args.map(String) : [],
        env: server.env as Record<string, string> | undefined,
        url: server.url ? String(server.url) : undefined,
        type: (server.type as TransportType) || "http",
        headers: normalizeHeaders(server.headers),
        bearerToken: server.bearerToken ? String(server.bearerToken) : undefined,
      } as ImportedServer;
    });
  }

  /** Import from file */
  importFromFile(filePath: string): Result & { format?: string; servers?: ImportedServer[] } {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: "File not found" };
    }

    try {
      const content = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(content);
      const parsed = this.parseImportData(data);

      if (!parsed) {
        return { success: false, error: "Unknown format" };
      }

      return { success: true, ...parsed };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Import from a client */
  importFromClient(clientId: string): Result & { format?: string; servers?: ImportedServer[] } {
    const clientService = getClientService();
    const clientConfig = clientService.readClientConfig(clientId as ClientId);

    if (!clientConfig) {
      return { success: false, error: "Client config not found" };
    }

    const parsed = this.parseImportData(clientConfig);

    if (!parsed) {
      return { success: false, error: "No servers found in client config" };
    }

    return { success: true, ...parsed };
  }

  /** Compare two servers and identify differences */
  private compareServers(
    existing: LocalServer | RemoteServer,
    incoming: ImportedServer
  ): FieldDifference[] {
    const differences: FieldDifference[] = [];
    const isLocal = "command" in existing;

    if (isLocal) {
      const existingLocal = existing as LocalServer;

      // Compare command
      if (existingLocal.command !== incoming.command) {
        differences.push({
          field: "command",
          existing: existingLocal.command,
          incoming: incoming.command,
          isDifferent: true,
        });
      }

      // Compare args
      const existingArgs = JSON.stringify(existingLocal.args || []);
      const incomingArgs = JSON.stringify(incoming.args || []);
      if (existingArgs !== incomingArgs) {
        differences.push({
          field: "args",
          existing: existingLocal.args,
          incoming: incoming.args,
          isDifferent: true,
        });
      }

      // Compare env
      const existingEnv = JSON.stringify(existingLocal.env || {});
      const incomingEnv = JSON.stringify(incoming.env || {});
      if (existingEnv !== incomingEnv) {
        differences.push({
          field: "env",
          existing: existingLocal.env,
          incoming: incoming.env,
          isDifferent: true,
        });
      }

      // Compare name
      if (existingLocal.name !== incoming.name) {
        differences.push({
          field: "name",
          existing: existingLocal.name,
          incoming: incoming.name,
          isDifferent: true,
        });
      }
    } else {
      const existingRemote = existing as RemoteServer;

      // Compare URL
      if (existingRemote.url !== incoming.url) {
        differences.push({
          field: "url",
          existing: existingRemote.url,
          incoming: incoming.url,
          isDifferent: true,
        });
      }

      // Compare type
      if (existingRemote.type !== incoming.type) {
        differences.push({
          field: "type",
          existing: existingRemote.type,
          incoming: incoming.type,
          isDifferent: true,
        });
      }

      // Compare bearerToken
      if (existingRemote.bearerToken !== incoming.bearerToken) {
        differences.push({
          field: "bearerToken",
          existing: existingRemote.bearerToken ? "***" : undefined,
          incoming: incoming.bearerToken ? "***" : undefined,
          isDifferent: true,
        });
      }

      const existingHeaders = JSON.stringify(existingRemote.headers || {});
      const incomingHeaders = JSON.stringify(incoming.headers || {});
      if (existingHeaders !== incomingHeaders) {
        differences.push({
          field: "headers",
          existing: existingRemote.headers,
          incoming: incoming.headers,
          isDifferent: true,
        });
      }

      // Compare name
      if (existingRemote.name !== incoming.name) {
        differences.push({
          field: "name",
          existing: existingRemote.name,
          incoming: incoming.name,
          isDifferent: true,
        });
      }
    }

    return differences;
  }

  /** Detect conflicts between imported servers and existing servers */
  detectConflicts(servers: ImportedServer[]): ConflictsDetectionResult {
    const configService = getConfigService();
    const conflicts: ServerConflict[] = [];
    const noConflicts: ImportedServer[] = [];

    for (const server of servers) {
      const existing =
        server.serverType === "remote"
          ? configService.findRemoteServer(server.id)
          : configService.findLocalServer(server.id);

      if (existing) {
        const differences = this.compareServers(existing, server);

        // If there are NO differences, treat as no-conflict (auto-skip identical servers)
        if (differences.every((d) => !d.isDifferent)) {
          noConflicts.push(server);
        } else {
          // Only report as conflict if there are actual differences
          conflicts.push({
            id: server.id,
            name: server.name,
            type: server.serverType,
            existing,
            incoming: server,
            differences,
          });
        }
      } else {
        noConflicts.push(server);
      }
    }

    return {
      conflicts,
      noConflicts,
      totalConflicts: conflicts.length,
    };
  }

  /** Intelligently merge two servers, combining non-conflicting fields */
  private mergeServerFields(
    existing: LocalServer | RemoteServer,
    incoming: ImportedServer
  ): LocalServer | RemoteServer {
    const isLocal = "command" in existing;

    if (isLocal) {
      const existingLocal = existing as LocalServer;
      // For local servers, prefer incoming command/args but merge env
      const mergedEnv = {
        ...(existingLocal.env || {}),
        ...(incoming.env || {}),
      };

      return {
        id: existingLocal.id,
        name: incoming.name || existingLocal.name,
        command: incoming.command || existingLocal.command,
        args: incoming.args !== undefined ? incoming.args : existingLocal.args,
        env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
      } as LocalServer;
    } else {
      const existingRemote = existing as RemoteServer;
      const mergedHeaders = {
        ...(existingRemote.headers || {}),
        ...(incoming.headers || {}),
      };
      // For remote servers, prefer incoming URL but keep existing token if not provided
      return {
        id: existingRemote.id,
        name: incoming.name || existingRemote.name,
        url: incoming.url || existingRemote.url,
        type: incoming.type || existingRemote.type,
        headers: Object.keys(mergedHeaders).length > 0 ? mergedHeaders : undefined,
        bearerToken: incoming.bearerToken || existingRemote.bearerToken,
      } as RemoteServer;
    }
  }

  /** Merge servers into config with per-server conflict decisions */
  mergeServersWithDecisions(
    servers: ImportedServer[],
    decisions: Map<string, ConflictResolution> = new Map()
  ): MergeResults {
    const configService = getConfigService();
    const results: MergeResults = { added: 0, skipped: 0, updated: 0, merged: 0 };

    for (const server of servers) {
      const decision = decisions.get(server.id) || "skip";

      if (server.serverType === "remote") {
        if (!server.url) {
          console.warn(`Skipping remote server ${server.id}: missing URL`);
          results.skipped++;
          continue;
        }

        const existing = configService.findRemoteServer(server.id);

        if (existing) {
          if (decision === "overwrite") {
            configService.updateRemoteServer(server.id, {
              name: server.name || server.id,
              url: server.url,
              type: (server.type || "http") as TransportType,
              headers: server.headers,
              bearerToken: server.bearerToken,
            });
            results.updated++;
          } else if (decision === "merge") {
            const mergedServer = this.mergeServerFields(existing, server) as RemoteServer;
            configService.updateRemoteServer(server.id, mergedServer);
            if (results.merged !== undefined) {
              results.merged++;
            }
          } else {
            results.skipped++;
          }
        } else {
          configService.addRemoteServer({
            id: server.id,
            name: server.name || server.id,
            url: server.url,
            type: (server.type || "http") as TransportType,
            headers: server.headers,
            bearerToken: server.bearerToken,
          });
          results.added++;
        }
      } else {
        if (!server.command) {
          console.warn(`Skipping local server ${server.id}: missing command`);
          results.skipped++;
          continue;
        }

        const existing = configService.findLocalServer(server.id);

        if (existing) {
          if (decision === "overwrite") {
            configService.updateLocalServer(server.id, {
              name: server.name || server.id,
              command: server.command,
              args: server.args || [],
              env: server.env,
            });
            results.updated++;
          } else if (decision === "merge") {
            const mergedServer = this.mergeServerFields(existing, server) as LocalServer;
            configService.updateLocalServer(server.id, mergedServer);
            if (results.merged !== undefined) {
              results.merged++;
            }
          } else {
            results.skipped++;
          }
        } else {
          configService.addLocalServer({
            id: server.id,
            name: server.name || server.id,
            command: server.command,
            args: server.args || [],
            env: server.env,
          });
          results.added++;
        }
      }
    }

    return results;
  }

  /** Merge servers into config */
  mergeServers(servers: ImportedServer[], options: { overwrite?: boolean } = {}): MergeResults {
    const configService = getConfigService();
    const { overwrite = false } = options;
    const results: MergeResults = { added: 0, skipped: 0, updated: 0, merged: 0 };

    for (const server of servers) {
      if (server.serverType === "remote") {
        // Validate required fields for remote server
        if (!server.url) {
          console.warn(`Skipping remote server ${server.id}: missing URL`);
          results.skipped++;
          continue;
        }

        const existing = configService.findRemoteServer(server.id);

        if (existing) {
          if (overwrite) {
            configService.updateRemoteServer(server.id, {
              name: server.name || server.id,
              url: server.url,
              type: (server.type || "http") as TransportType,
              headers: server.headers,
              bearerToken: server.bearerToken,
            });
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          configService.addRemoteServer({
            id: server.id,
            name: server.name || server.id,
            url: server.url,
            type: (server.type || "http") as TransportType,
            headers: server.headers,
            bearerToken: server.bearerToken,
          });
          results.added++;
        }
      } else {
        // Validate required fields for local server
        if (!server.command) {
          console.warn(`Skipping local server ${server.id}: missing command`);
          results.skipped++;
          continue;
        }
        const existing = configService.findLocalServer(server.id);

        if (existing) {
          if (overwrite) {
            configService.updateLocalServer(server.id, {
              name: server.name || server.id,
              command: server.command,
              args: server.args || [],
              env: server.env,
            });
            results.updated++;
          } else {
            results.skipped++;
          }
        } else {
          configService.addLocalServer({
            id: server.id,
            name: server.name || server.id,
            command: server.command,
            args: server.args || [],
            env: server.env,
          });
          results.added++;
        }
      }
    }

    return results;
  }

  /** Export to JSON format (Claude Desktop / Cursor compatible) */
  exportToJsonFormat(): ClaudeFormat {
    const configService = getConfigService();
    const mcpServers: ClaudeFormat["mcpServers"] = {};

    // Export local servers
    for (const server of configService.getLocalServers()) {
      mcpServers[server.id] = {
        command: server.command,
        args: server.args || [],
      };
      if (server.env && Object.keys(server.env).length > 0) {
        mcpServers[server.id].env = server.env;
      }
    }

    // Export remote servers as mcp-remote commands
    for (const server of configService.getRemoteServers()) {
      mcpServers[server.id] = {
        command: "npx",
        args: ["-y", "mcp-remote", server.url],
      };
      if (server.bearerToken) {
        mcpServers[server.id].env = { MCP_AUTH_TOKEN: server.bearerToken };
      }
    }

    return { mcpServers };
  }

  /** Export to MCPSM format */
  exportToMcpsmFormat(): McpsmFormat {
    const configService = getConfigService();
    const localServers = configService.getLocalServers();
    const remoteServers = configService.getRemoteServers();

    return {
      servers: localServers.map((s) => ({
        id: s.id,
        name: s.name,
        command: s.command,
        args: s.args,
        env: s.env,
      })),
      remoteServers: remoteServers.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        url: s.url,
        headers: s.headers,
        bearerToken: s.bearerToken,
      })),
      port: configService.getPort(),
    };
  }

  /** Export configuration */
  export(format: ExportFormat = "mcpsm"): unknown {
    switch (format.toLowerCase()) {
      case "json":
        return this.exportToJsonFormat();
      case "mcpsm":
      default:
        return this.exportToMcpsmFormat();
    }
  }

  /** Export to file */
  exportToFile(filePath: string, format: ExportFormat = "mcpsm"): Result {
    try {
      const exported = this.export(format);
      const output = JSON.stringify(exported, null, 2);
      const resolvedPath = path.resolve(filePath);
      fs.writeFileSync(resolvedPath, output);
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Get available import sources */
  getAvailableSources(): { clients: string[]; description: string }[] {
    const clientService = getClientService();
    const detected = clientService.detectClients();

    return detected
      .filter((c) => c.installed && c.hasConfig)
      .map((c) => ({
        clients: [c.id],
        description: `Import from ${c.name}`,
      }));
  }
}

/** Singleton instance */
let instance: ImportExportService | null = null;

/** Get or create the import/export service instance */
export function getImportExportService(): ImportExportService {
  if (!instance) {
    instance = new ImportExportService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetImportExportService(): void {
  instance = null;
}

export default ImportExportService;
