/**
 * Services index - exports all service classes and getters
 */

// Config service
export { ConfigService, getConfigService, resetConfigService } from "./config.service.js";

// Settings service
export { SettingsService, getSettingsService, resetSettingsService } from "./settings.service.js";

// Profile service
export { ProfileService, getProfileService, resetProfileService } from "./profile.service.js";

// Client service
export { ClientService, getClientService, resetClientService } from "./client.service.js";
export { changeGatewayPort, type PortUpdateResult } from "./gateway-port.service.js";

// Testing service
export { TestingService, getTestingService, resetTestingService } from "./testing.service.js";

// Daemon service
export { DaemonService, getDaemonService, resetDaemonService } from "./daemon.service.js";

// Import/Export service
export {
  ImportExportService,
  getImportExportService,
  resetImportExportService,
} from "./import-export.service.js";

// Gateway service
export {
  startGateway,
  stopGateway,
  getGatewayStatus,
  refreshGateway,
  runGatewayForeground,
} from "./gateway.service.js";

// Auth service
export { AuthService, getAuthService, resetAuthService } from "./auth.service.js";

// Environment service
export {
  EnvironmentService,
  getEnvironmentService,
  resetEnvironmentService,
} from "./environment.service.js";

// Version service
export { getVersionService } from "./version.service.js";

// Re-export types used by services
export type {
  AppConfig,
  LocalServer,
  RemoteServer,
  Server,
  OAuthConfig,
  StoredOAuthTokens,
  ToolFilters,
  ServerToolFilter,
  ConfigPaths,
  Settings,
  Profile,
  ProfilesConfig,
  ProfileListItem,
  ClientId,
  DetectedClient,
  ClientStatus,
  ServerTestResult,
  Result,
  OperationResult,
  AuthStatus,
  AuthResult,
  TokenResponse,
  AuthServerMetadata,
  ServerAuthRequirements,
} from "../types/index.js";

export { runDoctorChecks } from "./doctor.service.js";

export { refreshDaemonIfRunning } from "./daemon-refresh.js";
