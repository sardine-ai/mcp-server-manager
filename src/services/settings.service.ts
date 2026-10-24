/**
 * Settings service - manages application settings
 */

import type { Settings, SettingInfo, SettingsInfo, SettingResult } from "../types/index.js";
import { getConfigService } from "./config.service.js";
import { readPrivateJsonFile, writePrivateJsonFile } from "../shared/secure-storage.js";

/** Default settings */
const DEFAULT_SETTINGS: Settings = {
  port: 8850,
  editor: process.env.EDITOR || process.env.VISUAL || "vi",
};

/** Internal settings (not exposed in Settings interface, kept for future expansion) */
const INTERNAL_THEME = "default";

/** Settings metadata */
const SETTINGS_INFO: SettingsInfo = {
  port: {
    description: "Gateway port",
    type: "number",
    default: 8850,
  },
  editor: {
    description: "Preferred editor for config files",
    type: "string",
    default: "vi",
  },
};

/** Settings service class */
export class SettingsService {
  private settingsPath: string;
  private settings: Settings;

  constructor() {
    const configService = getConfigService();
    this.settingsPath = configService.getPaths().settingsPath;
    this.settings = this.load();
  }

  /** Load settings from file */
  private load(): Settings {
    const parsed = readPrivateJsonFile<Partial<Settings>>(this.settingsPath);
    return { ...globalThis.structuredClone(DEFAULT_SETTINGS), ...parsed };
  }

  /** Save settings to file */
  private save(settings = this.settings): void {
    const { port: _port, ...stored } = settings;
    readPrivateJsonFile(this.settingsPath);
    writePrivateJsonFile(this.settingsPath, stored);
  }

  /** Get all settings */
  getAll(): Settings {
    return { ...this.settings, port: getConfigService().getPort() };
  }

  /** Get a single setting */
  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.getAll()[key];
  }

  /** Set a single setting with validation */
  set<K extends keyof Settings>(key: K, value: unknown): SettingResult {
    if (key === "port") {
      const port = typeof value === "string" ? Number(value) : value;
      if (typeof port !== "number") return { success: false, error: "Port must be a number" };
      const result = getConfigService().setPort(port);
      return result.success ? { success: true, value: port } : result;
    }
    const info = SETTINGS_INFO[key];
    if (!info) {
      return { success: false, error: `Unknown setting: ${key}` };
    }

    let parsedValue: Settings[K];

    // Type conversion and validation
    if (info.type === "number") {
      const num = Number(value);
      if (isNaN(num)) {
        return { success: false, error: `Invalid number: ${value}` };
      }
      parsedValue = num as Settings[K];
    } else {
      parsedValue = String(value) as Settings[K];
    }

    // Validate options
    if (info.options && !info.options.includes(String(parsedValue))) {
      return {
        success: false,
        error: `Invalid value. Options: ${info.options.join(", ")}`,
      };
    }

    const settings = { ...this.settings, [key]: parsedValue };
    this.save(settings);
    this.settings = settings;

    return { success: true, value: parsedValue };
  }

  /** Reset all settings to defaults */
  reset(): void {
    const result = getConfigService().setPort(DEFAULT_SETTINGS.port);
    if (!result.success) throw new Error(result.error);
    const settings = { ...DEFAULT_SETTINGS };
    this.save(settings);
    this.settings = settings;
  }

  /** Get settings metadata */
  getInfo(): SettingsInfo {
    return SETTINGS_INFO;
  }

  /** Get info for a specific setting */
  getSettingInfo(key: keyof Settings): SettingInfo | undefined {
    return SETTINGS_INFO[key];
  }

  /** Check if a value is the default */
  isDefault<K extends keyof Settings>(key: K): boolean {
    return this.get(key) === DEFAULT_SETTINGS[key];
  }

  /** Get available keys */
  getKeys(): (keyof Settings)[] {
    return Object.keys(SETTINGS_INFO) as (keyof Settings)[];
  }

  /** Get options for a setting (static or dynamic) */
  getOptions(key: keyof Settings): string[] | undefined {
    const info = SETTINGS_INFO[key];

    // Static options
    if (info.options) {
      return info.options;
    }

    return undefined;
  }

  /** Get theme (internal use only, not exposed in Settings interface) */
  getTheme(): "default" {
    return INTERNAL_THEME;
  }
}

/** Singleton instance */
let instance: SettingsService | null = null;

/** Get or create the settings service instance */
export function getSettingsService(): SettingsService {
  if (!instance) {
    instance = new SettingsService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetSettingsService(): void {
  instance = null;
}

export default SettingsService;
