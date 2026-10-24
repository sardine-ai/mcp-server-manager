import { validatePort } from "../../shared/validators.js";
import path from "path";
import type { AppConfig, ConfigPaths, SelectionState, ToolFilters } from "../../types/index.js";
import {
  ensurePrivateDirectory,
  readPrivateJsonFile,
  writePrivateJsonFile,
} from "../../shared/secure-storage.js";

const DEFAULT_CONFIG: AppConfig = {
  servers: [],
  remoteServers: [],
  port: 8850,
};

export class ConfigRepository {
  private configDir: string;
  private paths: ConfigPaths;
  private config: AppConfig = { ...DEFAULT_CONFIG };
  private toolFilters: ToolFilters = {};
  private selectionState: SelectionState = { local: [], remote: [] };

  constructor(configDir?: string) {
    this.configDir =
      configDir ||
      process.env.MCP_MANAGER_CONFIG_DIR ||
      path.join(process.env.HOME || process.env.USERPROFILE || "", ".mcp-manager");

    this.paths = {
      configDir: this.configDir,
      configPath: path.join(this.configDir, "config.json"),
      toolFiltersPath: path.join(this.configDir, "tool-filters.json"),
      selectionStatePath: path.join(this.configDir, "selection-state.json"),
      settingsPath: path.join(this.configDir, "settings.json"),
      profilesPath: path.join(this.configDir, "profiles.json"),
      clientsStatePath: path.join(this.configDir, "clients.json"),
    };

    this.ensureConfigDir();
    this.reload();
  }

  reload(): void {
    const config = this.loadConfig();
    const toolFilters = this.loadToolFilters();
    const selectionState = this.loadSelectionState();
    this.config = config;
    this.toolFilters = toolFilters;
    this.selectionState = selectionState;
  }

  getPaths(): ConfigPaths {
    return this.paths;
  }

  getConfig(): AppConfig {
    return this.config;
  }

  saveConfig(): void {
    writePrivateJsonFile(this.paths.configPath, this.config);
  }

  updateConfig(mutator: (config: AppConfig) => void): void {
    const next = globalThis.structuredClone(this.config);
    mutator(next);
    writePrivateJsonFile(this.paths.configPath, next);
    this.config = next;
  }

  getToolFilters(): ToolFilters {
    return this.toolFilters;
  }

  saveToolFilters(): void {
    writePrivateJsonFile(this.paths.toolFiltersPath, this.toolFilters);
  }

  updateToolFilters(mutator: (filters: ToolFilters) => void): void {
    const next = globalThis.structuredClone(this.toolFilters);
    mutator(next);
    writePrivateJsonFile(this.paths.toolFiltersPath, next);
    this.toolFilters = next;
  }

  getSelectionState(): SelectionState {
    return this.selectionState;
  }

  saveSelectionState(state: SelectionState): void {
    writePrivateJsonFile(this.paths.selectionStatePath, state);
    this.selectionState = state;
  }

  private ensureConfigDir(): void {
    ensurePrivateDirectory(this.configDir);
  }

  private loadConfig(): AppConfig {
    const parsed = readPrivateJsonFile<Partial<AppConfig>>(this.paths.configPath);
    const legacy =
      parsed && typeof parsed.port === "number" && validatePort(parsed.port).valid
        ? undefined
        : readPrivateJsonFile<{ port?: unknown }>(this.paths.settingsPath);
    const legacyPort =
      typeof legacy?.port === "number" && validatePort(legacy.port).valid
        ? legacy.port
        : DEFAULT_CONFIG.port;
    const config = {
      servers: Array.isArray(parsed?.servers) ? parsed.servers : [],
      remoteServers: Array.isArray(parsed?.remoteServers) ? parsed.remoteServers : [],
      port:
        typeof parsed?.port === "number" && validatePort(parsed.port).valid
          ? parsed.port
          : legacyPort,
    };
    if (!parsed) writePrivateJsonFile(this.paths.configPath, config);
    return config;
  }

  private loadToolFilters(): ToolFilters {
    return readPrivateJsonFile<ToolFilters>(this.paths.toolFiltersPath) ?? {};
  }

  private loadSelectionState(): SelectionState {
    return (
      readPrivateJsonFile<SelectionState>(this.paths.selectionStatePath) ?? {
        local: [],
        remote: [],
      }
    );
  }
}
