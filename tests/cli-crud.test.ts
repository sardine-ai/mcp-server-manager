import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import configFixture from "./fixtures/sardine-config.json";
import { REDACTED_PLACEHOLDER } from "../src/shared/redaction.js";

const CLI = "node bin/cli.js";
const TEST_TIMEOUT = process.platform === "win32" ? 20000 : 10000;
vi.setConfig({ testTimeout: TEST_TIMEOUT });

describe("CLI CRUD flows with sardine config", () => {
  let testConfigDir: string;
  let configPath: string;

  beforeEach(() => {
    testConfigDir = path.join(os.tmpdir(), `mcpsm-cli-crud-${Date.now()}-${Math.random()}`);
    configPath = path.join(testConfigDir, "config.json");

    fs.mkdirSync(testConfigDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(configFixture, null, 2));
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  const cliEnv = (): Record<string, string | undefined> => ({
    ...process.env,
    MCP_MANAGER_CONFIG_DIR: testConfigDir,
  });

  it("removes and re-adds the stdio server via CLI", () => {
    execSync(`${CLI} remove sardineinternalsandbox --yes`, {
      cwd: process.cwd(),
      env: cliEnv(),
      stdio: "pipe",
    });

    let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.servers.find((s: any) => s.id === "sardineinternalsandbox")).toBeUndefined();

    execSync(
      `${CLI} add sardineInternalSandbox -t stdio -c npx --args "@sardine-ai/internal-mcp,--project-id,sandbox-sardine-ai,--location,US,--bigquery-project-id,sandbox-sardine-users-bq"`,
      {
        cwd: process.cwd(),
        env: cliEnv(),
        stdio: "pipe",
      }
    );

    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const added = config.servers.find((s: any) => s.id === "sardineinternalsandbox");
    expect(added).toBeDefined();
    expect(added.command).toBe("npx");
    expect(added.args).toEqual([
      "@sardine-ai/internal-mcp",
      "--project-id",
      "sandbox-sardine-ai",
      "--location",
      "US",
      "--bigquery-project-id",
      "sandbox-sardine-users-bq",
    ]);
  });

  it("edits, removes, and re-adds a remote server and redacts tokens in JSON output", () => {
    execSync(
      `${CLI} edit devin --name devin-updated --url https://mcp.devin.ai/updated --token NEW_TOKEN --header X-Org-Id=org_JVU8h2dxO575yI66`,
      {
        cwd: process.cwd(),
        env: cliEnv(),
        stdio: "pipe",
      }
    );

    let config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const edited = config.remoteServers.find((s: any) => s.id === "devin");
    expect(edited).toBeDefined();
    expect(edited.name).toBe("devin-updated");
    expect(edited.url).toBe("https://mcp.devin.ai/updated");
    expect(edited.bearerToken).toBe("NEW_TOKEN");
    expect(edited.headers).toEqual({ "X-Org-Id": "org_JVU8h2dxO575yI66" });

    execSync(`${CLI} remove devin --yes`, {
      cwd: process.cwd(),
      env: cliEnv(),
      stdio: "pipe",
    });
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(config.remoteServers.find((s: any) => s.id === "devin")).toBeUndefined();

    execSync(
      `${CLI} add devin -t sse -u https://mcp.devin.ai/sse --token RESTORED_TOKEN --header X-Org-Id=org_JVU8h2dxO575yI66`,
      {
        cwd: process.cwd(),
        env: cliEnv(),
        stdio: "pipe",
      }
    );

    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const readded = config.remoteServers.find((s: any) => s.id === "devin");
    expect(readded).toBeDefined();
    expect(readded.bearerToken).toBe("RESTORED_TOKEN");
    expect(readded.headers).toEqual({ "X-Org-Id": "org_JVU8h2dxO575yI66" });

    const jsonOutput = execSync(`${CLI} list --json`, {
      cwd: process.cwd(),
      env: cliEnv(),
      encoding: "utf8",
    });
    const parsed = JSON.parse(jsonOutput);

    const metamcp = parsed.servers.find((s: any) => s.id === "metamcp");
    expect(metamcp.env.API_ACCESS_TOKEN).toBe(REDACTED_PLACEHOLDER);

    const devinOutput = parsed.remoteServers.find((s: any) => s.id === "devin");
    expect(devinOutput.bearerToken).toBe(REDACTED_PLACEHOLDER);
    expect(devinOutput.headers).toEqual({ "X-Org-Id": REDACTED_PLACEHOLDER });
  });

  it("edits env vars on a stdio server via CLI", () => {
    execSync(`${CLI} edit metamcp --env API_ACCESS_TOKEN=UPDATED,FOO=bar`, {
      cwd: process.cwd(),
      env: cliEnv(),
      stdio: "pipe",
    });

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const metamcp = config.servers.find((s: any) => s.id === "metamcp");
    expect(metamcp).toBeDefined();
    expect(metamcp.env).toEqual({
      API_ACCESS_TOKEN: "UPDATED",
      FOO: "bar",
    });
  });
});
