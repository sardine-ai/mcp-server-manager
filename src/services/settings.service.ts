/**
 * Settings service - manages application settings
 */

import fs from "fs";
import type { Settings, SettingInfo, SettingsInfo, SettingResult } from "../types/index.js";
import { getConfigService } from "./config.service.js";
import { createLogger } from "../shared/logger.js";
import { protectExistingPrivateFile, writePrivateJsonFile } from "../shared/secure-storage.js";

const log = createLogger("SettingsService");

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
    try {
      if (fs.existsSync(this.settingsPath)) {
        protectExistingPrivateFile(this.settingsPath);
        const data = fs.readFileSync(this.settingsPath, "utf8");
        const parsed = JSON.parse(data) as Partial<Settings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (error) {
      log.debug("Failed to load settings, using defaults:", error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  /** Save settings to file */
  private save(): void {
    writePrivateJsonFile(this.settingsPath, this.settings);
  }

  /** Get all settings */
  getAll(): Settings {
    return { ...this.settings };
  }

  /** Get a single setting */
  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

  /** Set a single setting with validation */
  set<K extends keyof Settings>(key: K, value: unknown): SettingResult {
    const info = SETTINGS_INFO[key];
    if (!info) {
      return { success: false, error: `Unknown setting: ${key}` };
    }

    let parsedValue: Settings[K];

    // Type conversion and validation
    if (info.type === "number") {
      const num = parseInt(String(value), 10);
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

    this.settings[key] = parsedValue;
    this.save();

    return { success: true, value: parsedValue };
  }

  /** Reset all settings to defaults */
  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
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
    return this.settings[key] === DEFAULT_SETTINGS[key];
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
