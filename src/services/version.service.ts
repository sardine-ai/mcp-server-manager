/**
 * Version Service - Checks for package updates
 */

import { createLogger } from "../shared/logger.js";
import { VERSION } from "../shared/version.js";

const log = createLogger("VersionService");

interface VersionInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
  installCommand: string;
}

function detectPackageManager(): string {
  try {
    const execPath = process.argv[1] || "";

    if (execPath.includes(".bun/")) return "bun";
    if (execPath.includes("/pnpm/") || execPath.includes("/pnpm-global/")) return "pnpm";
    if (execPath.includes("/yarn/") || execPath.includes("/.yarn/")) return "yarn";
  } catch {
    // ignore
  }

  return "npm";
}

function getInstallCommand(pm: string): string {
  switch (pm) {
    case "bun":
      return "bun install -g mcp-server-manager";
    case "pnpm":
      return "pnpm install -g mcp-server-manager";
    case "yarn":
      return "yarn global add mcp-server-manager";
    default:
      return "npm install -g mcp-server-manager";
  }
}

class VersionService {
  private cachedVersionInfo: VersionInfo | null = null;
  private lastCheckTime: number = 0;
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
  private checkPromise: Promise<VersionInfo> | null = null;

  /**
   * Check for available updates
   */
  async checkForUpdate(): Promise<VersionInfo> {
    const now = Date.now();

    // Return cached result if still valid
    if (this.cachedVersionInfo && now - this.lastCheckTime < this.CACHE_DURATION) {
      return this.cachedVersionInfo;
    }

    // Return existing promise if check is in progress
    if (this.checkPromise) {
      return this.checkPromise;
    }

    // Start new check
    this.checkPromise = this.performVersionCheck();

    try {
      const result = await this.checkPromise;
      this.cachedVersionInfo = result;
      this.lastCheckTime = now;
      return result;
    } finally {
      this.checkPromise = null;
    }
  }

  /**
   * Perform the actual version check against npm registry
   */
  private async performVersionCheck(): Promise<VersionInfo> {
    const installCommand = getInstallCommand(detectPackageManager());

    try {
      const response = await fetch("https://registry.npmjs.org/mcp-server-manager/latest", {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as { version: string };
      const latestVersion = data.version;
      const hasUpdate = this.compareVersions(VERSION, latestVersion) < 0;

      return {
        current: VERSION,
        latest: latestVersion,
        hasUpdate,
        installCommand,
      };
    } catch (error) {
      log.debug("Failed to check for updates:", error);
      return {
        current: VERSION,
        latest: VERSION,
        hasUpdate: false,
        installCommand,
      };
    }
  }

  /**
   * Compare two semantic version strings
   * @returns -1 if v1 < v2, 0 if v1 === v2, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split(".").map(Number);
    const parts2 = v2.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      const num1 = parts1[i] || 0;
      const num2 = parts2[i] || 0;

      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }

    return 0;
  }

  /**
   * Get cached version info without triggering a check
   */
  getCachedVersionInfo(): VersionInfo | null {
    return this.cachedVersionInfo;
  }

  /**
   * Clear the cache (useful for testing)
   */
  clearCache(): void {
    this.cachedVersionInfo = null;
    this.lastCheckTime = 0;
  }
}

// Singleton instance
let versionServiceInstance: VersionService | null = null;

export function getVersionService(): VersionService {
  if (!versionServiceInstance) {
    versionServiceInstance = new VersionService();
  }
  return versionServiceInstance;
}
