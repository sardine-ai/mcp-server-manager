/**
 * Settings-related type definitions
 */

/** Application settings */
export interface Settings {
  /** Gateway port */
  port: number;
  /** Preferred editor for config files */
  editor: string;
  /** Comma-separated browser origins allowed to call the gateway (empty = none) */
  allowedOrigins: string;
}

/** Available theme options (kept for future use) */
export type ThemeOption = "default";

/** Setting value types */
export type SettingType = "number" | "string" | "boolean";

/** Setting info */
export interface SettingInfo {
  /** Human-readable description */
  description: string;
  /** Value type */
  type: SettingType;
  /** Default value */
  default: string | number | boolean;
  /** Available options for string settings */
  options?: string[];
}

/** Settings info map */
export type SettingsInfo = Record<keyof Settings, SettingInfo>;

/** Setting set result */
export interface SettingResult {
  success: boolean;
  error?: string;
  value?: string | number | boolean;
}
