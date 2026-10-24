import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

const mocks = vi.hoisted(() => ({
  changeGatewayPort: vi.fn(async (_port: number) => {
    const result: { success: boolean; port: number; warnings: string[]; error?: string } = {
      success: true,
      port: 9000,
      warnings: [],
    };
    return result;
  }),
  reset: vi.fn(),
  set: vi.fn(() => ({ success: true, value: "nano" })),
}));
vi.mock("../src/services/gateway-port.service.js", () => ({
  changeGatewayPort: mocks.changeGatewayPort,
}));
vi.mock("../src/services/config.service.js", () => ({
  getConfigService: () => ({ getPort: () => 8850 }),
}));
vi.mock("../src/services/settings.service.js", () => ({
  getSettingsService: () => ({
    getKeys: () => ["port", "editor"],
    getInfo: () => ({ port: { default: 8850 } }),
    set: mocks.set,
    reset: mocks.reset,
  }),
}));

import { registerUtilityCommands } from "../src/cli/commands/utility.cmd.js";
import { registerSettingsCommands } from "../src/cli/commands/settings.cmd.js";

describe("CLI gateway port entry points", () => {
  async function run(args: string[]) {
    const program = new Command();
    registerUtilityCommands(program);
    registerSettingsCommands(program);
    await program.parseAsync(args, { from: "user" });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.changeGatewayPort.mockResolvedValue({
      success: true,
      port: 9000,
      warnings: [],
      error: undefined,
    });
    process.exitCode = 0;
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
  });

  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it.each([
    ["port", "9000"],
    ["settings", "set", "port", "9000"],
  ])("uses the shared operation for %j", async (...args) => {
    await run(args);
    expect(mocks.changeGatewayPort).toHaveBeenCalledWith(9000);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it.each([
    ["port", "9000"],
    ["settings", "set", "port", "9000"],
    ["settings", "reset", "--yes"],
  ])("reports partial failures for %j with an unsuccessful exit status", async (...args) => {
    mocks.changeGatewayPort.mockResolvedValue({
      success: false,
      port: 9000,
      warnings: ["project config is read-only"],
      error: "project config is read-only",
    });
    await run(args);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("project config is read-only")
    );
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("resets the port through the shared operation before resetting other settings", async () => {
    await run(["settings", "reset", "--yes"]);
    expect(mocks.changeGatewayPort).toHaveBeenCalledWith(8850);
    expect(mocks.reset).toHaveBeenCalled();
    expect(mocks.changeGatewayPort.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reset.mock.invocationCallOrder[0]
    );
  });

  it("does not reset settings after the port change is rejected", async () => {
    mocks.changeGatewayPort.mockResolvedValue({
      success: false,
      port: 8850,
      warnings: [],
      error: "cannot save port",
    });
    await run(["settings", "reset", "--yes"]);
    expect(process.exitCode).toBe(1);
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("cannot save port"));
  });

  it("reports a settings reset write failure after saving the port", async () => {
    mocks.reset.mockImplementationOnce(() => {
      throw new Error("read-only settings");
    });
    await run(["settings", "reset", "--yes"]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("settings could not be reset")
    );
    expect(process.exit).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("keeps non-port settings on their existing path", async () => {
    await run(["settings", "set", "editor", "nano"]);
    expect(mocks.set).toHaveBeenCalledWith("editor", "nano");
    expect(mocks.changeGatewayPort).not.toHaveBeenCalled();
  });
});
