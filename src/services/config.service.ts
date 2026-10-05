import type {
  AppConfig,
  ConfigPaths,
  LocalServer,
  RemoteServer,
  Result,
  SelectionState,
  Server,
  ServerToolFilter,
  ToolFilters,
} from "../types/index.js";
import { ConfigRepository } from "./config/config.repository.js";
import { SelectionService } from "./config/selection.service.js";
import { ToolFilterService } from "./config/tool-filter.service.js";
import { ServerManager } from "./config/server.manager.js";
import { GatewayConfigService } from "./config/gateway-config.service.js";

export class ConfigService {
  private repository: ConfigRepository;
  private serverManager: ServerManager;
  private toolFilterService: ToolFilterService;
  private selectionService: SelectionService;
  private gatewayConfigService: GatewayConfigService;

  constructor(configDir?: string) {
    this.repository = new ConfigRepository(configDir);
    this.selectionService = new SelectionService(this.repository);
    this.toolFilterService = new ToolFilterService(this.repository);
    this.gatewayConfigService = new GatewayConfigService(this.repository);
    this.serverManager = new ServerManager(
      this.repository,
      this.selectionService,
      this.toolFilterService
    );
  }

  reload(): void {
    this.repository.reload();
  }

  getPaths(): ConfigPaths {
    return this.repository.getPaths();
  }

  getConfig(): AppConfig {
    return this.repository.getConfig();
  }

  saveConfig(): void {
    this.repository.saveConfig();
  }

  // === Server accessors ===
  getLocalServers(): LocalServer[] {
    return this.serverManager.getLocalServers();
  }

  getRemoteServers(): RemoteServer[] {
    return this.serverManager.getRemoteServers();
  }

  getAllServers(): Server[] {
    return this.serverManager.getAllServers();
  }

  // === Gateway config ===
  getPort(): number {
    return this.gatewayConfigService.getPort();
  }

  setPort(port: number): Result {
    return this.gatewayConfigService.setPort(port);
  }

  // === Tool filters ===
  getToolFilters(): ToolFilters {
    return this.toolFilterService.getToolFilters();
  }

  getServerToolFilter(serverId: string): ServerToolFilter | undefined {
    return this.toolFilterService.getServerToolFilter(serverId);
  }

  setServerToolFilter(serverId: string, filter: ServerToolFilter): void {
    this.toolFilterService.setServerToolFilter(serverId, filter);
  }

  saveToolFilters(): void {
    this.repository.saveToolFilters();
  }

  // === Selection state ===
  getSelectionState(): SelectionState {
    return this.selectionService.getSelectionState();
  }

  saveSelectionState(state: SelectionState): void {
    this.selectionService.saveSelectionState(state);
  }

  // === Server CRUD Operations ===
  findServer(idOrName: string): { server: Server; type: "local" | "remote" } | null {
    return this.serverManager.findServer(idOrName);
  }

  findLocalServer(id: string): LocalServer | undefined {
    return this.serverManager.findLocalServer(id);
  }

  findRemoteServer(id: string): RemoteServer | undefined {
    return this.serverManager.findRemoteServer(id);
  }

  generateServerId(name: string): string {
    return this.serverManager.generateServerId(name);
  }

  addLocalServer(server: LocalServer): Result {
    return this.serverManager.addLocalServer(server);
  }

  addRemoteServer(server: RemoteServer): Result {
    return this.serverManager.addRemoteServer(server);
  }

  updateLocalServer(id: string, updates: Partial<LocalServer>): Result {
    return this.serverManager.updateLocalServer(id, updates);
  }

  updateRemoteServer(id: string, updates: Partial<RemoteServer>): Result {
    return this.serverManager.updateRemoteServer(id, updates);
  }

  deleteLocalServer(id: string): Result {
    return this.serverManager.deleteLocalServer(id);
  }

  deleteRemoteServer(id: string): Result {
    return this.serverManager.deleteRemoteServer(id);
  }

  deleteServer(id: string): Result {
    return this.serverManager.deleteServer(id);
  }

  getFilterId(serverId: string, type: "local" | "remote"): string {
    return type === "local" ? serverId : `remote:${serverId}`;
  }

  removeLocalServer(id: string): Result {
    return this.deleteLocalServer(id);
  }

  removeRemoteServer(id: string): Result {
    return this.deleteRemoteServer(id);
  }

  // === Tool Filter Operations ===
  toggleTool(filterId: string, toolName: string): void {
    this.toolFilterService.toggleTool(filterId, toolName);
  }

  enableTool(filterId: string, toolName: string): void {
    this.toolFilterService.enableTool(filterId, toolName);
  }

  disableTool(filterId: string, toolName: string): void {
    this.toolFilterService.disableTool(filterId, toolName);
  }

  enableAllTools(filterId: string): void {
    this.toolFilterService.enableAllTools(filterId);
  }

  disableAllTools(filterId: string): void {
    this.toolFilterService.disableAllTools(filterId);
  }

  resetToolFilters(filterId: string): Result {
    return this.toolFilterService.resetToolFilters(filterId);
  }

  isToolEnabled(filterId: string, toolName: string): boolean {
    return this.toolFilterService.isToolEnabled(filterId, toolName);
  }

  getEnabledTools(filterId: string): string[] {
    return this.toolFilterService.getEnabledTools(filterId);
  }

  getDisabledTools(filterId: string): string[] {
    return this.toolFilterService.getDisabledTools(filterId);
  }
}

let instance: ConfigService | null = null;

export function getConfigService(configDir?: string): ConfigService {
  if (!instance) {
    instance = new ConfigService(configDir);
  }
  return instance;
}

export function resetConfigService(): void {
  instance = null;
}

export default ConfigService;
