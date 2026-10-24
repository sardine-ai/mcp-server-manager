import { getDaemonService } from "./daemon.service.js";

export async function refreshDaemonIfRunning() {
  const daemon = getDaemonService();
  if (!daemon.isDaemonRunning().running) return { success: true };
  return daemon.refreshDaemon();
}
