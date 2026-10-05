/**
 * Client Strategy Pattern type definitions
 * Defines the interface and types for client integration strategies
 */

import type {
  Platform,
  ClientMcpConfig,
  ClientServerConfig,
  OperationResult,
  ClientStatus,
} from "./index.js";

/**
 * Configuration format types supported by different clients
 */
export type ConfigFormat = "json" | "toml";

/**
 * Gateway connection type - how the client connects to MCPSM
 * - stdio: Uses supergateway (npx -y supergateway --streamableHttp ...)
 * - url-only: Direct URL/HTTP connection (each strategy defines exact format)
 */
export type GatewayType = "stdio" | "url-only";

/**
 * Client capability flags
 */
export interface ClientCapabilities {
  /** Whether the client supports real-time config reloading */
  supportsRealTimeReload: boolean;
  /** Whether the client has a secondary (real-time) config path */
  hasSecondaryConfigPath: boolean;
  /** Config format used by this client */
  configFormat: ConfigFormat;
  /** Gateway connection type */
  gatewayType: GatewayType;
}

/**
 * Platform-specific paths for a client
 */
export interface ClientPlatformPaths {
  /** Primary config path per platform */
  primary: Partial<Record<Platform, string>>;
  project?: string;
  /** Secondary (real-time) config path, if applicable */
  secondary?: string | null;
  /** App bundle paths for installation detection (macOS) */
  appBundles?: Partial<Record<Platform, string>>;
  /** Binary paths for CLI tools */
  binaryPaths?: Partial<Record<Platform, string>>;
}

/**
 * Client metadata
 */
export interface ClientMetadata {
  /** Unique client identifier */
  id: string;
  /** Human-readable display name */
  displayName: string;
  /** Client description */
  description?: string;
}

/**
 * Client Strategy Interface - defines all client-specific behavior
 */
export interface IClientStrategy {
  /** Client metadata */
  readonly metadata: ClientMetadata;

  /** Client capabilities */
  readonly capabilities: ClientCapabilities;

  /** Platform paths configuration */
  readonly paths: ClientPlatformPaths;

  // === Path Resolution ===

  /**
   * Get the primary config path for the current platform
   */
  getPrimaryConfigPath(platform: Platform): string | null;

  /**
   * Get the secondary (real-time) config path if applicable
   */
  getSecondaryConfigPath(): string | null;

  /**
   * Get the effective config path used for read/write operations
   * (may be secondary if client supports real-time reload)
   */
  getEffectiveConfigPath(platform: Platform): string | null;

  // === Installation Detection ===

  /**
   * Check if the client is installed on the current platform
   */
  isInstalled(platform: Platform): boolean;

  // === Configuration I/O ===

  /**
   * Read and parse the client's configuration
   */
  readConfig(): ClientMcpConfig | null;

  /**
   * Write configuration back to the client's config file
   */
  writeConfig(config: ClientMcpConfig): boolean;

  // === Gateway Management ===

  /**
   * Build the gateway server configuration for this client
   */
  buildGatewayConfig(port: number, profileId?: string): ClientServerConfig;

  /**
   * Check if the gateway is present in the config
   */
  hasGateway(config: ClientMcpConfig | null, profileId?: string): boolean;

  /**
   * Add the gateway to the configuration
   */
  addGateway(config: ClientMcpConfig, port: number, profileId?: string): ClientMcpConfig;

  /**
   * Remove the gateway from the configuration
   */
  removeGateway(config: ClientMcpConfig, profileId?: string): ClientMcpConfig;

  // === High-Level Operations ===

  /**
   * Connect the client to MCPSM
   */
  connect(port: number, profileId?: string): OperationResult;

  /**
   * Disconnect the client from MCPSM
   */
  disconnect(profileId?: string): OperationResult;

  /**
   * Get the current connection status
   */
  getStatus(platform: Platform, profileId?: string): ClientStatus;

  /**
   * Count servers in the client's config
   */
  getServerCount(): number;
}
