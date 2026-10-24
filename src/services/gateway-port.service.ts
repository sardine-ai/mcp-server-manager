import { getConfigService } from "./config.service.js";
import { getDaemonService, type DaemonStatus } from "./daemon.service.js";
import { validatePort } from "../shared/validators.js";
import { getClientStrategy, getRegisteredClientIds } from "./clients/index.js";
import { ProjectConnectionsService } from "./project-connections.service.js";
import type { ClientId, Platform } from "../types/index.js";

export interface PortUpdateResult {
  success: boolean;
  port: number;
  error?: string;
  warnings: string[];
}

let portUpdateQueue: Promise<unknown> = Promise.resolve();

async function refreshDaemonForPortChange(status: DaemonStatus, portChanged: boolean) {
  if (!status.running) return { success: true };

  const daemon = getDaemonService();
  if (!portChanged) {
    const health = await daemon.checkHealth();
    if (health.status === "ok") return { success: true };
  }
  return daemon.refreshDaemon(status, true);
}

function updateClientGatewayPorts(port: number) {
  const warnings: string[] = [];
  const targets: { clientId: ClientId; projectDir?: string }[] = getRegisteredClientIds().map(
    (clientId) => ({ clientId })
  );
  try {
    targets.push(...new ProjectConnectionsService().list());
  } catch (error) {
    warnings.push(
      `${error instanceof Error ? error.message : String(error)}. Project gateways could not be updated.`
    );
  }
  for (const { clientId, projectDir } of targets) {
    const strategy = getClientStrategy(clientId, projectDir);
    const configPath = strategy?.getEffectiveConfigPath(process.platform as Platform);
    if (!strategy || !configPath) continue;
    try {
      const config = strategy.readConfigForUpdate();
      if (!config) {
        if (projectDir)
          warnings.push(
            `${configPath}: config is missing. Reconnect ${clientId} in ${projectDir} when it is available.`
          );
        continue;
      }
      const result = strategy.updateGatewayPort(port);
      if (!result.success) throw new Error(result.error || "Failed to write config");
    } catch (error) {
      warnings.push(
        `${configPath}: ${error instanceof Error ? error.message : String(error)}. Reconnect ${clientId}${projectDir ? ` in ${projectDir}` : " globally"} to update its gateway port.`
      );
    }
  }
  return warnings;
}

async function applyGatewayPort(port: number) {
  const config = getConfigService();
  const previousPort = config.getPort();
  const result: PortUpdateResult = { success: false, port: previousPort, warnings: [] };
  const validation = validatePort(port);
  if (!validation.valid) {
    result.error = validation.error;
    return result;
  }

  const status = getDaemonService().getPortUpdateStatus();
  try {
    const saved = config.setPort(port);
    if (!saved.success) {
      result.error = saved.error;
      return result;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }

  result.port = port;
  result.warnings = updateClientGatewayPorts(port);

  try {
    const refresh = await refreshDaemonForPortChange(status, previousPort !== port);
    if (!refresh.success)
      result.warnings.push(
        (refresh.error || "Daemon readiness was not confirmed") + ". Restart the daemon."
      );
  } catch (error) {
    result.warnings.push(
      (error instanceof Error ? error.message : String(error)) + ". Restart the daemon."
    );
  }

  result.success = result.warnings.length === 0;
  result.error = result.warnings.join("; ") || undefined;
  return result;
}

export function changeGatewayPort(port: number) {
  const update = portUpdateQueue.then(() => applyGatewayPort(port));
  portUpdateQueue = update.catch(() => undefined);
  return update;
}
