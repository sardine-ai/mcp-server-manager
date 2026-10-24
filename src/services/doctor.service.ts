import { execSync } from "child_process";
import fs from "fs";
import { getConfigService } from "./config.service.js";

/** Check if a command exists */
function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Get command version */
function getVersion(cmd: string): string | null {
  try {
    const result = execSync(`${cmd} --version`, { encoding: "utf8" });
    return result.trim().split("\n")[0];
  } catch {
    return null;
  }
}

export function runDoctorChecks() {
  const checks: Array<{ name: string; status: boolean; info: string }> = [];

  // Node.js
  const nodeVersion = process.version;
  const nodeOk = parseInt(nodeVersion.slice(1)) >= 18;
  checks.push({
    name: "Node.js",
    status: nodeOk,
    info: nodeOk ? nodeVersion : `${nodeVersion} (requires >= 18.0.0)`,
  });

  // Python
  const pythonExists = commandExists("python3") || commandExists("python");
  const pythonVersion = pythonExists ? getVersion("python3") || getVersion("python") : null;
  checks.push({
    name: "Python",
    status: pythonExists,
    info: pythonVersion || "not found",
  });

  // uv
  const uvExists = commandExists("uv");
  const uvVersion = uvExists ? getVersion("uv") : null;
  checks.push({
    name: "uv",
    status: uvExists,
    info: uvVersion || "not found (optional)",
  });

  // uvx
  const uvxExists = commandExists("uvx");
  checks.push({
    name: "uvx",
    status: uvxExists,
    info: uvxExists ? "available" : "not found (optional)",
  });

  // npm
  const npmExists = commandExists("npm");
  const npmVersion = npmExists ? getVersion("npm") : null;
  checks.push({
    name: "npm",
    status: npmExists,
    info: npmVersion || "not found",
  });

  // Config directory
  const configService = getConfigService();
  const paths = configService.getPaths();
  const configExists = fs.existsSync(paths.configDir);
  checks.push({
    name: "Config directory",
    status: configExists,
    info: configExists ? paths.configDir : "not created",
  });

  // Config file
  const configFileExists = fs.existsSync(paths.configPath);
  checks.push({
    name: "Config file",
    status: configFileExists,
    info: configFileExists ? "exists" : "not found",
  });

  // Servers count
  const localServers = configService.getLocalServers();
  const remoteServers = configService.getRemoteServers();
  const totalServers = localServers.length + remoteServers.length;
  checks.push({
    name: "Servers configured",
    status: true,
    info: `${totalServers} (${localServers.length} local, ${remoteServers.length} remote)`,
  });

  return checks;
}
