/**
 * Environment service - detects environment-related information
 */

import { execSync } from "child_process";
import os from "os";
import path from "path";
import { createLogger } from "../shared/logger.js";

const log = createLogger("EnvironmentService");

/** Shell information */
export interface ShellInfo {
  shell: string;
  isZsh: boolean;
  path?: string;
}

/** Environment service class */
export class EnvironmentService {
  private shellCache: ShellInfo | null = null;

  /** Detect available shells and return the best one to use */
  detectShell(): ShellInfo {
    if (this.shellCache) {
      return this.shellCache;
    }

    // Default to bash
    const result: ShellInfo = {
      shell: "bash",
      isZsh: false,
    };

    try {
      // Check if we're currently running in zsh
      if (process.env.SHELL?.includes("zsh")) {
        result.shell = "zsh";
        result.isZsh = true;
        result.path = process.env.SHELL;
        log.debug("Detected current shell: zsh");
      } else {
        // Try to find zsh in common locations
        const zshPaths = ["/bin/zsh", "/usr/bin/zsh", "/usr/local/bin/zsh"];

        for (const zshPath of zshPaths) {
          try {
            execSync(`test -x "${zshPath}"`, { stdio: "ignore" });
            result.shell = "zsh";
            result.isZsh = true;
            result.path = zshPath;
            log.debug(`Found zsh at: ${zshPath}`);
            break;
          } catch {
            // Continue checking other paths
          }
        }

        if (!result.isZsh) {
          // Fallback to bash
          const bashPaths = ["/bin/bash", "/usr/bin/bash"];
          for (const bashPath of bashPaths) {
            try {
              execSync(`test -x "${bashPath}"`, { stdio: "ignore" });
              result.path = bashPath;
              log.debug(`Found bash at: ${bashPath}`);
              break;
            } catch {
              // Continue checking other paths
            }
          }
        }
      }
    } catch (error) {
      log.debug("Error detecting shell:", error);
      // Keep defaults
    }

    this.shellCache = result;
    return result;
  }

  /** Get the shell command to use for spawning processes */
  getShellCommand(): string {
    const { shell, path } = this.detectShell();
    return path || shell;
  }

  /** Check if zsh is available and should be used */
  shouldUseZsh(): boolean {
    return this.detectShell().isZsh;
  }

  /**
   * Expand a leading ~ in a server command. Commands are spawned without a
   * shell word-splitting them, so this has to happen here.
   */
  expandHome(command: string): string {
    if (command === "~") return os.homedir();
    if (command.startsWith("~/")) return path.join(os.homedir(), command.slice(2));
    return command;
  }

  /** Get shell environment variables */
  getShellEnv(): Record<string, string> {
    const { isZsh, path } = this.detectShell();

    if (!isZsh || !path) {
      return {};
    }

    try {
      // Source zsh config and get environment
      const envOutput = execSync(`${path} -i -c 'env'`, {
        encoding: "utf8",
        timeout: 5000,
      });

      const env: Record<string, string> = {};
      const lines = envOutput.split("\n");

      for (const line of lines) {
        const eqIndex = line.indexOf("=");
        if (eqIndex > 0) {
          const key = line.substring(0, eqIndex);
          const value = line.substring(eqIndex + 1);
          env[key] = value;
        }
      }

      return env;
    } catch (error) {
      log.debug("Failed to get zsh environment:", error);
      return {};
    }
  }

  /** Reset shell cache (for testing) */
  resetCache(): void {
    this.shellCache = null;
  }
}

/** Singleton instance */
let instance: EnvironmentService | null = null;

/** Get or create the environment service instance */
export function getEnvironmentService(): EnvironmentService {
  if (!instance) {
    instance = new EnvironmentService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetEnvironmentService(): void {
  instance = null;
}

export default EnvironmentService;
