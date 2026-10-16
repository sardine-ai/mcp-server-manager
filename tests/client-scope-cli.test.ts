import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const mocks = vi.hoisted(() => {
  function service() {
    return {
      clientExists: vi.fn(() => true),
      getClientName: vi.fn(() => "Cursor"),
      isClientInstalled: vi.fn(() => true),
      supportsProjectConfig: vi.fn(() => true),
      connectClient: vi.fn(() => ({ success: true })),
      connectAllProfiles: vi.fn(() => ({ succeeded: ["dev"], failed: [] })),
      disconnectClient: vi.fn(() => ({ success: true })),
      disconnectAllProfiles: vi.fn(() => ({ succeeded: ["dev"], failed: [] })),
      detectClients: vi.fn(() => []),
      getClientConfigPath: vi.fn(() => "/project/.cursor/mcp.json"),
      openClientConfig: vi.fn(() => ({ success: true })),
    };
  }
  return { global: service(), project: service(), promptSelect: vi.fn(), constructor: vi.fn() };
});

vi.mock("../src/services/client.service.js", () => ({
  getClientService: () => mocks.global,
  ClientService: class {
    constructor(projectDir: string) {
      mocks.constructor(projectDir);
      return mocks.project;
    }
  },
}));
vi.mock("../src/shared/prompts.js", () => ({ promptSelect: mocks.promptSelect }));
vi.mock("../src/services/profile.service.js", () => ({
  getProfileService: () => ({ exists: () => true }),
}));

import { registerClientCommands } from "../src/cli/commands/client.cmd.js";

async function run(args: string[]) {
  const program = new Command();
  registerClientCommands(program);
  await program.parseAsync(["clients", ...args], { from: "user" });
}

describe("CLI client scope", () => {
  const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ttyDescriptor) Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    else Reflect.deleteProperty(process.stdin, "isTTY");
  });

  it("connects a profile in the current folder with an explicit scope", async () => {
    await run(["connect", "cursor", "--scope", "project", "--profile", "dev"]);
    expect(mocks.constructor).toHaveBeenCalledWith(process.cwd());
    expect(mocks.project.connectClient).toHaveBeenCalledWith("cursor", "dev");
    expect(mocks.global.connectClient).not.toHaveBeenCalled();
    expect(mocks.promptSelect).not.toHaveBeenCalled();
  });

  it("keeps non-interactive commands global by default", async () => {
    await run(["connect", "cursor"]);
    expect(mocks.global.connectAllProfiles).toHaveBeenCalledWith("cursor");
    expect(mocks.promptSelect).not.toHaveBeenCalled();
  });

  it("offers the current folder interactively", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    mocks.promptSelect.mockResolvedValue("project");
    await run(["connect", "cursor"]);
    expect(mocks.promptSelect).toHaveBeenCalled();
    expect(mocks.project.connectAllProfiles).toHaveBeenCalledWith("cursor");
  });

  it("does not connect when the scope prompt is cancelled", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    mocks.promptSelect.mockResolvedValue(null);
    await run(["connect", "cursor"]);
    expect(mocks.global.connectAllProfiles).not.toHaveBeenCalled();
    expect(mocks.project.connectAllProfiles).not.toHaveBeenCalled();
  });

  it("uses project scope for list, open and disconnect", async () => {
    await run(["list", "--scope", "project", "--json"]);
    await run(["open", "cursor", "--scope", "project"]);
    await run(["disconnect", "cursor", "--scope", "project"]);
    expect(mocks.project.detectClients).toHaveBeenCalled();
    expect(mocks.project.openClientConfig).toHaveBeenCalledWith("cursor");
    expect(mocks.project.disconnectAllProfiles).toHaveBeenCalledWith("cursor");
  });

  it("rejects invalid scopes before touching client configs", async () => {
    await expect(run(["connect", "cursor", "--scope", "invalid"])).rejects.toThrow(
      "Scope must be global or project"
    );
    expect(mocks.global.connectAllProfiles).not.toHaveBeenCalled();
    expect(mocks.project.connectAllProfiles).not.toHaveBeenCalled();
  });
});
