/**
 * Import/Export-related type definitions
 */

import type { LocalServer, RemoteServer, TransportType } from "./server.types.js";
import type { ClientId } from "./client.types.js";

/** Imported server (generic) */
export interface ImportedServer {
  id: string;
  name: string;
  serverType: "local" | "remote";
  // Local server fields
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // Remote server fields
  url?: string;
  type?: TransportType;
  headers?: Record<string, string>;
  bearerToken?: string;
}

/** Export format types */
export type ExportFormat = "mcpsm" | "claude";

/** Import source types */
export type ImportSource = "file" | ClientId;

/** MCPSM export format */
export interface McpsmExport {
  version: string;
  exportedAt: string;
  servers: LocalServer[];
  remoteServers: RemoteServer[];
}

/** Claude Desktop export format */
export interface ClaudeExport {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
}

/** Export options */
export interface ExportOptions {
  /** Export format */
  format?: ExportFormat;
  /** Output file path */
  outputPath?: string;
}

/** Import options */
export interface ImportOptions {
  /** Import source (file path or client ID) */
  source: string;
  /** Source type */
  sourceType: ImportSource;
  /** Merge with existing or replace */
  merge?: boolean;
  /** Skip duplicates */
  skipDuplicates?: boolean;
}

/** Import result */
export interface ImportResult {
  success: boolean;
  error?: string;
  imported: number;
  skipped: number;
  errors: string[];
}

/** Export result */
export interface ExportResult {
  success: boolean;
  error?: string;
  path?: string;
  serverCount?: number;
}

/** Import preview item */
export interface ImportPreviewItem {
  id: string;
  name: string;
  type: "local" | "remote";
  exists: boolean;
  action: "add" | "skip" | "replace";
}

/** Import preview */
export interface ImportPreview {
  items: ImportPreviewItem[];
  totalNew: number;
  totalSkipped: number;
  totalReplaced: number;
}

/** Conflict resolution strategy */
export type ConflictResolution = "overwrite" | "skip" | "merge";

/** Field difference in a conflict */
export interface FieldDifference {
  field: string;
  existing: unknown;
  incoming: unknown;
  isDifferent: boolean;
}

/** Server conflict details */
export interface ServerConflict {
  id: string;
  name: string;
  type: "local" | "remote";
  existing: LocalServer | RemoteServer;
  incoming: ImportedServer;
  differences: FieldDifference[];
}

/** Conflicts detection result */
export interface ConflictsDetectionResult {
  conflicts: ServerConflict[];
  noConflicts: ImportedServer[];
  totalConflicts: number;
}

/** Per-server conflict decision */
export interface ConflictDecision {
  serverId: string;
  resolution: ConflictResolution;
  mergedServer?: LocalServer | RemoteServer;
}

/** Merge results with conflict resolution */
export interface MergeResults {
  added: number;
  updated: number;
  skipped: number;
  merged?: number;
}
