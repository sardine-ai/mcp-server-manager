/**
 * Daemon service - manages gateway daemon process
 */

import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync, ChildProcess } from "child_process";
import { ofetch } from "ofetch";
import { getConfigService } from "./config.service.js";
import { getEnvironmentService } from "./environment.service.js";
import type { Result } from "../types/index.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("DaemonService");

/** Health check configuration constants */
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const REFRESH_HEALTH_CHECK_TIMEOUT_MS = 500;
const REFRESH_HEALTH_CHECK_RETRY_COUNT = 5;
const REFRESH_HEALTH_CHECK_RETRY_DELAY_MS = 100;
export const STARTUP_HEALTH_CHECK_MAX_ATTEMPTS = 30;
export const STARTUP_HEALTH_CHECK_INTERVAL_MS = 500;

/** Health check response from the daemon */
export interface DaemonHealthResponse {
  status: "ok" | "error";
  servers?: number;
  tools?: number;
  error?: string;
}

/** Daemon status */
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  healthy?: boolean;
  health?: DaemonHealthResponse;
}

/** Daemon service class */
export class DaemonService {
  private configDir: string;
  private pidFile: string;
  private logFile: string;
  private logsDir: string;
  private restartLock: Promise<void>;

  constructor() {
    const configService = getConfigService();
    this.configDir = configService.getPaths().configDir;
    this.logsDir = path.join(this.configDir, "logs");
    this.pidFile = path.join(this.configDir, "daemon.pid");
    this.logFile = path.join(this.logsDir, "gateway.log");
    this.restartLock = Promise.resolve();

    this.ensureLogsDir();
  }

  /** Ensure logs directory exists */
  private ensureLogsDir(): void {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  /** Find PIDs of processes LISTENING on a specific port (not clients connected to it) */
  private findProcessesByPort(port: number): number[] {
    const pids: number[] = [];
    try {
      if (process.platform === "darwin" || process.platform === "linux") {
        // Use lsof to find processes LISTENING on the port (not clients)
        // -sTCP:LISTEN filters to only show processes in LISTEN state
        const output = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        const lines = output
          .trim()
          .split("\n")
          .filter((line) => line.trim());
        for (const line of lines) {
          const pid = parseInt(line.trim(), 10);
          if (!isNaN(pid) && pid > 0) {
            pids.push(pid);
          }
        }
      }
    } catch {
      // lsof returns non-zero exit code if no processes found, which is fine
      log.debug(`No processes found listening on port ${port}`);
    }
    return pids;
  }

  /** Kill a process and wait for it to terminate */
  private async killProcess(pid: number, signal: string = "SIGTERM"): Promise<boolean> {
    try {
      if (pid === process.pid) {
        log.warn(`Refusing to signal current process (PID: ${pid})`);
        return false;
      }
      process.kill(pid, signal as "SIGTERM" | "SIGKILL");

      // Wait for process to terminate (check every 100ms, max 5 seconds)
      for (let i = 0; i < 50; i++) {
        try {
          process.kill(pid, 0); // Check if process exists
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch {
          // Process no longer exists
          return true;
        }
      }

      // Process still running after SIGTERM, try SIGKILL
      if (signal === "SIGTERM") {
        log.warn(`Process ${pid} did not terminate with SIGTERM, trying SIGKILL`);
        return await this.killProcess(pid, "SIGKILL");
      }

      return false;
    } catch (error) {
      log.debug(`Error killing process ${pid}:`, error);
      return false;
    }
  }

  getPortUpdateStatus() {
    try {
      const pid = Number(fs.readFileSync(this.pidFile, "utf8"));
      if (Number.isInteger(pid) && pid > 0) {
        const command = execSync(`ps -p ${pid} -o args=`, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        if (
          /(?:bin\/cli\.js|dist\/cli\/index\.js)\s+daemon start --foreground(?:\s|$)/.test(command)
        ) {
          return { running: true, pid };
        }
      }
    } catch {}
    return this.isDaemonRunning();
  }

  /** Check if daemon is running */
  isDaemonRunning(port = getConfigService().getPort()): DaemonStatus {
    // Primary check: Is there a process listening on the daemon port?
    const portPids = this.findProcessesByPort(port);
    if (portPids.length === 0) {
      // No process on port = daemon not running
      // Clean up stale PID file if it exists
      if (fs.existsSync(this.pidFile)) {
        try {
          fs.unlinkSync(this.pidFile);
          log.debug("Cleaned up stale PID file (no process on port)");
        } catch (error) {
          log.debug("Failed to remove stale PID file:", error);
        }
      }
      return { running: false };
    }

    // Found process(es) on the port
    const pid = portPids[0];
    log.debug(`Found process on port ${port}: PID ${pid}`);

    // Update PID file to reflect the actual running process
    // (This handles cases where daemon was started externally or PID file is stale)
    try {
      fs.writeFileSync(this.pidFile, pid.toString());
    } catch (error) {
      log.debug("Failed to update PID file:", error);
    }

    return { running: true, pid };
  }

  /** Check if any process is using the daemon port */
  private isPortInUse(port: number): boolean {
    const pids = this.findProcessesByPort(port);
    return pids.length > 0;
  }

  /**
   * Check daemon health by calling the /health endpoint.
   * This verifies the daemon's HTTP server is actually responding.
   */
  async checkHealth(timeoutMs = HEALTH_CHECK_TIMEOUT_MS): Promise<DaemonHealthResponse> {
    const configService = getConfigService();
    const port = configService.getPort();
    const url = `http://localhost:${port}/health`;

    try {
      const data = await ofetch<{ status: string; servers?: number; tools?: number }>(url, {
        timeout: timeoutMs,
        retry: 0,
      });

      return {
        status: data.status === "ok" ? "ok" : "error",
        servers: data.servers,
        tools: data.tools,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.debug(`Health check failed: ${message}`);

      if (message.includes("ECONNREFUSED")) {
        return { status: "error", error: "Connection refused - daemon not responding" };
      }
      if (message.includes("timeout") || message.includes("abort")) {
        return { status: "error", error: "Health check timed out" };
      }

      return { status: "error", error: message };
    }
  }

  /** Start daemon */
  async startDaemon(): Promise<Result & { pid?: number }> {
    const status = this.isDaemonRunning();
    if (status.running) {
      return { success: false, error: `Daemon already running (PID: ${status.pid})` };
    }

    // Check if port is in use by any process
    // Retry a few times in case port is still being released
    const configService = getConfigService();
    const port = configService.getPort();

    // Try up to 3 times with delays
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
      }

      if (!this.isPortInUse(port)) {
        break; // Port is free, proceed
      }

      if (attempt === 2) {
        // Last attempt failed, check what's using the port
        const pids = this.findProcessesByPort(port);
        // If no PIDs found, port might be in TIME_WAIT, try starting anyway
        if (pids.length === 0) {
          log.debug(
            `Port ${port} appears in use but no processes found, attempting to start anyway`
          );
          break;
        }
        return {
          success: false,
          error: `Port ${port} is already in use by process(es): ${pids.join(", ")}. Please stop the daemon first.`,
        };
      }
    }

    // Find the CLI path - using import.meta.url for ES modules
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const cliPath = path.join(currentDir, "..", "..", "bin", "cli.js");

    // Check if dist exists, use that instead
    const distCliPath = path.join(currentDir, "..", "..", "dist", "cli", "index.js");
    const finalCliPath = fs.existsSync(distCliPath) ? distCliPath : cliPath;

    // Start the gateway process in background
    this.ensureLogsDir();
    const logStream = fs.openSync(this.logFile, "a");

    const env: Record<string, string | undefined> = { ...process.env, MCPSM_DAEMON: "1" };

    // Get environment service to detect shell and use it to spawn the node process
    const envService = getEnvironmentService();
    const shellCommand = envService.getShellCommand();

    // Prepend the current Node's bin dir inside the command so it takes
    // effect after the login shell finishes sourcing profile scripts.
    // This ensures the daemon and child processes use the same Node version.
    const nodeBinDir = path.dirname(process.execPath);
    const fullCommand = `export PATH="${nodeBinDir}:$PATH" && "${process.execPath}" "${finalCliPath}" daemon start --foreground`;

    const child: ChildProcess = spawn(shellCommand, ["-l", "-c", fullCommand], {
      detached: true,
      stdio: ["ignore", logStream, logStream],
      env,
    });

    child.unref();

    // Save PID
    if (child.pid) {
      fs.writeFileSync(this.pidFile, child.pid.toString());
      return { success: true, pid: child.pid };
    }

    return { success: false, error: "Failed to start daemon process" };
  }

  /** Stop daemon */
  async stopDaemon(): Promise<Result> {
    const configService = getConfigService();
    const port = configService.getPort();
    const pidsToKill = new Set<number>();

    // Only stop processes that are bound to the daemon port
    const portPids = this.findProcessesByPort(port);
    for (const pid of portPids) {
      pidsToKill.add(pid);
    }

    if (pidsToKill.size === 0) {
      // Clean up PID file if it exists but no processes found
      if (fs.existsSync(this.pidFile)) {
        try {
          fs.unlinkSync(this.pidFile);
        } catch (error) {
          log.debug("Failed to remove PID file:", error);
        }
      }
      return { success: true };
    }

    // Kill all processes
    const killPromises = Array.from(pidsToKill).map((pid) => this.killProcess(pid));
    const results = await Promise.allSettled(killPromises);

    // Log any failures
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const pid = Array.from(pidsToKill)[i];
      if (result.status === "rejected" || !result.value) {
        log.warn(`Failed to kill process ${pid}`);
      }
    }

    // Clean up PID file
    if (fs.existsSync(this.pidFile)) {
      try {
        fs.unlinkSync(this.pidFile);
      } catch (error) {
        log.debug("Failed to remove PID file:", error);
      }
    }

    // Wait a bit more to ensure port is released
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify port is free - this is the most important check
    if (this.isPortInUse(port)) {
      const remainingPids = this.findProcessesByPort(port);
      return {
        success: false,
        error: `Port ${port} is still in use by process(es): ${remainingPids.join(", ")}`,
      };
    }

    // Return success if port is free, even if some kill operations had issues
    // (the port being free is what matters)
    return { success: true };
  }

  /** Ask the running daemon to refresh tool filters without reconnecting servers */
  async refreshTools(): Promise<Result> {
    const status = this.isDaemonRunning();
    if (!status.running || !status.pid) {
      return { success: false, error: "Daemon is not running" };
    }

    try {
      process.kill(status.pid, "SIGUSR1");
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ESRCH")) {
        log.warn("Failed to send tool refresh signal: process not found");
        return { success: false, error: "Daemon process not found" };
      }
      log.warn(`Failed to send tool refresh signal: ${message}`);
      return { success: false, error: message };
    }
  }

  /** Queue daemon restarts so we don't spawn overlapping processes */
  async restartDaemonSafely(): Promise<Result & { pid?: number }> {
    const run = async (): Promise<Result & { pid?: number }> => {
      const configService = getConfigService();
      const port = configService.getPort();
      const status = this.isDaemonRunning();

      // If nothing is running and the port is free, nothing to do
      if (!status.running && !this.isPortInUse(port)) {
        return { success: true };
      }

      const stopResult = await this.stopDaemon();
      if (!stopResult.success) {
        return { success: false, error: stopResult.error || "Failed to stop daemon" };
      }

      // Extra wait to ensure port is fully released before starting
      await new Promise((resolve) => setTimeout(resolve, 300));

      return this.startDaemon();
    };

    const restartPromise = this.restartLock.then(run, run);

    // Update lock but swallow errors so future restarts aren't blocked
    this.restartLock = restartPromise.then(
      () => undefined,
      () => undefined
    );

    return restartPromise;
  }

  /** Ask the running daemon to refresh its configuration without restarting */
  async refreshDaemon(target?: DaemonStatus, requireHealthy = false): Promise<Result> {
    const status = target ?? this.isDaemonRunning();
    if (!status.running || !status.pid) {
      return { success: false, error: "Daemon is not running" };
    }

    // Send SIGHUP signal to trigger refresh
    try {
      process.kill(status.pid, "SIGHUP");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ESRCH")) {
        log.warn("Failed to send refresh signal: process not found");
        return { success: false, error: "Daemon process not found" };
      }
      log.warn(`Failed to send refresh signal: ${message}`);
      return { success: false, error: message };
    }

    // Wait for daemon to be healthy after refresh
    try {
      const configService = getConfigService();
      const port = configService.getPort();
      const health = await ofetch<{ status?: string }>(`http://localhost:${port}/health`, {
        timeout: REFRESH_HEALTH_CHECK_TIMEOUT_MS,
        retry: REFRESH_HEALTH_CHECK_RETRY_COUNT,
        retryDelay: REFRESH_HEALTH_CHECK_RETRY_DELAY_MS,
      });
      if (requireHealthy && health.status !== "ok") {
        return { success: false, error: "Daemon responded without confirming readiness" };
      }
      return { success: true };
    } catch (error) {
      // Signal was sent successfully, but health check failed
      // This is expected if daemon is slow to respond - still consider success
      const message = error instanceof Error ? error.message : String(error);
      log.debug(`Refresh signal sent but health check inconclusive: ${message}`);
      if (requireHealthy)
        return {
          success: false,
          error: "Refresh signaled, but daemon readiness was not confirmed",
        };
      return { success: true };
    }
  }

  /** Restart the daemon if it's running */
  async restartDaemon(): Promise<Result & { pid?: number }> {
    const status = this.isDaemonRunning();
    if (!status.running) {
      return { success: false, error: "Daemon is not running" };
    }

    // Stop the daemon
    const stopResult = await this.stopDaemon();
    if (!stopResult.success) {
      return { success: false, error: `Failed to stop daemon: ${stopResult.error}` };
    }

    return {
      success: true,
      error: "Use startDaemon() to start with new configuration",
    };
  }

  /** Get logs */
  getLogs(lines = 50): string[] {
    if (!fs.existsSync(this.logFile)) {
      return [];
    }

    const content = fs.readFileSync(this.logFile, "utf8");
    const allLines = content.split("\n").filter((l) => l.trim());
    return allLines.slice(-lines);
  }

  /** Clear logs */
  clearLogs(): Result {
    if (fs.existsSync(this.logFile)) {
      fs.writeFileSync(this.logFile, "");
    }
    return { success: true };
  }

  /** Get log file path */
  getLogFilePath(): string {
    return this.logFile;
  }

  // === Startup Management ===

  /** Get LaunchAgent path for macOS */
  private getLaunchAgentPath(): string {
    return path.join(os.homedir(), "Library/LaunchAgents/com.mcpsm.gateway.plist");
  }

  /** Get systemd service path for Linux */
  private getSystemdPath(): string {
    return path.join(os.homedir(), ".config/systemd/user/mcpsm.service");
  }

  /** Generate LaunchAgent content for macOS */
  private generateLaunchAgentContent(): string {
    const nodePath = process.execPath;
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const cliPath = path.join(currentDir, "..", "..", "bin", "cli.js");
    const distCliPath = path.join(currentDir, "..", "..", "dist", "cli", "index.js");
    const finalCliPath = fs.existsSync(distCliPath) ? distCliPath : cliPath;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mcpsm.gateway</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${finalCliPath}</string>
        <string>daemon</string>
        <string>start</string>
        <string>--foreground</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${this.logFile}</string>
    <key>StandardErrorPath</key>
    <string>${this.logFile}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MCPSM_DAEMON</key>
        <string>1</string>
    </dict>
</dict>
</plist>`;
  }

  /** Generate systemd service content for Linux */
  private generateSystemdContent(): string {
    const nodePath = process.execPath;
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const cliPath = path.join(currentDir, "..", "..", "bin", "cli.js");
    const distCliPath = path.join(currentDir, "..", "..", "dist", "cli", "index.js");
    const finalCliPath = fs.existsSync(distCliPath) ? distCliPath : cliPath;

    return `[Unit]
Description=MCP Server Manager Gateway
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${finalCliPath} daemon start --foreground
Restart=always
Environment=MCPSM_DAEMON=1

[Install]
WantedBy=default.target`;
  }

  /** Check if startup is enabled */
  isStartupEnabled(): boolean {
    if (process.platform === "darwin") {
      return fs.existsSync(this.getLaunchAgentPath());
    } else if (process.platform === "linux") {
      return fs.existsSync(this.getSystemdPath());
    }
    return false;
  }

  /** Enable startup */
  enableStartup(): Result {
    if (process.platform === "darwin") {
      const launchAgentPath = this.getLaunchAgentPath();
      const content = this.generateLaunchAgentContent();

      const dir = path.dirname(launchAgentPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(launchAgentPath, content);

      try {
        execSync(`launchctl load "${launchAgentPath}"`, { stdio: "ignore" });
      } catch (error) {
        log.debug("launchctl load failed (may already be loaded):", error);
      }

      return { success: true };
    } else if (process.platform === "linux") {
      const systemdPath = this.getSystemdPath();
      const content = this.generateSystemdContent();

      const dir = path.dirname(systemdPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(systemdPath, content);

      try {
        execSync("systemctl --user daemon-reload", { stdio: "ignore" });
        execSync("systemctl --user enable mcpsm", { stdio: "ignore" });
      } catch (error) {
        log.debug("systemctl enable failed:", error);
      }

      return { success: true };
    }

    return { success: false, error: "Unsupported platform" };
  }

  /** Disable startup */
  disableStartup(): Result {
    if (process.platform === "darwin") {
      const launchAgentPath = this.getLaunchAgentPath();
      if (fs.existsSync(launchAgentPath)) {
        try {
          execSync(`launchctl unload "${launchAgentPath}"`, { stdio: "ignore" });
        } catch (error) {
          log.debug("launchctl unload failed:", error);
        }
        fs.unlinkSync(launchAgentPath);
      }
      return { success: true };
    } else if (process.platform === "linux") {
      const systemdPath = this.getSystemdPath();
      if (fs.existsSync(systemdPath)) {
        try {
          execSync("systemctl --user disable mcpsm", { stdio: "ignore" });
        } catch (error) {
          log.debug("systemctl disable failed:", error);
        }
        fs.unlinkSync(systemdPath);
      }
      return { success: true };
    }

    return { success: false, error: "Unsupported platform" };
  }

  /** Get platform info */
  getPlatformInfo(): { platform: string; supported: boolean; type: string } {
    if (process.platform === "darwin") {
      return { platform: "macOS", supported: true, type: "LaunchAgent" };
    } else if (process.platform === "linux") {
      return { platform: "Linux", supported: true, type: "systemd" };
    }
    return { platform: process.platform, supported: false, type: "none" };
  }

  /** Get full status with health check */
  async getStatus(): Promise<{
    running: boolean;
    pid?: number;
    startupEnabled: boolean;
    port: number;
    logFile: string;
    healthy: boolean;
    health?: DaemonHealthResponse;
  }> {
    const configService = getConfigService();
    const daemonStatus = this.isDaemonRunning();
    const port = configService.getPort();

    // If process isn't running, skip health check
    if (!daemonStatus.running) {
      return {
        running: false,
        startupEnabled: this.isStartupEnabled(),
        port,
        logFile: this.logFile,
        healthy: false,
      };
    }

    // Process is running, verify with health check
    const health = await this.checkHealth();
    const healthy = health.status === "ok";

    return {
      running: daemonStatus.running,
      pid: daemonStatus.pid,
      startupEnabled: this.isStartupEnabled(),
      port,
      logFile: this.logFile,
      healthy,
      health,
    };
  }
}

/** Singleton instance */
let instance: DaemonService | null = null;

/** Get or create the daemon service instance */
export function getDaemonService(): DaemonService {
  if (!instance) {
    instance = new DaemonService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetDaemonService(): void {
  instance = null;
}

export default DaemonService;
