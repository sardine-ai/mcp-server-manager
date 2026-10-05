import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execSync: execSyncMock,
}));

import {
  EnvironmentService,
  getEnvironmentService,
  resetEnvironmentService,
} from "../src/services/environment.service.js";

const originalShell = process.env.SHELL;

function restoreShell(): void {
  if (originalShell === undefined) {
    delete process.env.SHELL;
  } else {
    process.env.SHELL = originalShell;
  }
}

describe("EnvironmentService", () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    restoreShell();
    resetEnvironmentService();
  });

  afterEach(() => {
    restoreShell();
    resetEnvironmentService();
  });

  it("uses the current zsh shell and caches the detected value", () => {
    process.env.SHELL = "/bin/zsh";
    const service = new EnvironmentService();

    expect(service.detectShell()).toEqual({
      shell: "zsh",
      isZsh: true,
      path: "/bin/zsh",
    });

    process.env.SHELL = "/bin/bash";
    expect(service.detectShell()).toEqual({
      shell: "zsh",
      isZsh: true,
      path: "/bin/zsh",
    });
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("finds zsh in common locations when the current shell is not zsh", () => {
    process.env.SHELL = "/bin/bash";
    execSyncMock.mockImplementation((command: string) => {
      if (command.includes('"/usr/bin/zsh"')) {
        return undefined;
      }
      throw new Error("not executable");
    });
    const service = new EnvironmentService();

    expect(service.detectShell()).toEqual({
      shell: "zsh",
      isZsh: true,
      path: "/usr/bin/zsh",
    });
    expect(execSyncMock).toHaveBeenCalledWith('test -x "/bin/zsh"', { stdio: "ignore" });
    expect(execSyncMock).toHaveBeenCalledWith('test -x "/usr/bin/zsh"', { stdio: "ignore" });
  });

  it("falls back to bash when zsh is not available", () => {
    process.env.SHELL = "/bin/sh";
    execSyncMock.mockImplementation((command: string) => {
      if (command.includes('"/bin/bash"')) {
        return undefined;
      }
      throw new Error("not executable");
    });
    const service = new EnvironmentService();

    expect(service.detectShell()).toEqual({
      shell: "bash",
      isZsh: false,
      path: "/bin/bash",
    });
    expect(service.getShellCommand()).toBe("/bin/bash");
    expect(service.shouldUseZsh()).toBe(false);
  });

  it("keeps the bash default when shell probing fails", () => {
    process.env.SHELL = "/bin/sh";
    execSyncMock.mockImplementation(() => {
      throw new Error("probe failed");
    });
    const service = new EnvironmentService();

    expect(service.detectShell()).toEqual({
      shell: "bash",
      isZsh: false,
    });
    expect(service.getShellCommand()).toBe("bash");
  });

  it("parses environment variables from an interactive zsh", () => {
    process.env.SHELL = "/bin/zsh";
    execSyncMock.mockReturnValue("FOO=bar\nWITH_EQUALS=a=b\nIGNORED\n=bad\n");
    const service = new EnvironmentService();

    expect(service.getShellEnv()).toEqual({
      FOO: "bar",
      WITH_EQUALS: "a=b",
    });
    expect(execSyncMock).toHaveBeenCalledWith("/bin/zsh -i -c 'env'", {
      encoding: "utf8",
      timeout: 5000,
    });
  });

  it("returns an empty environment for non-zsh shells or failed zsh env calls", () => {
    process.env.SHELL = "/bin/sh";
    execSyncMock.mockImplementation(() => {
      throw new Error("not executable");
    });
    const bashService = new EnvironmentService();
    expect(bashService.getShellEnv()).toEqual({});

    process.env.SHELL = "/bin/zsh";
    execSyncMock.mockReset();
    execSyncMock.mockImplementation(() => {
      throw new Error("env failed");
    });
    const zshService = new EnvironmentService();
    expect(zshService.getShellEnv()).toEqual({});
  });

  it("resets the singleton instance used by getEnvironmentService", () => {
    const first = getEnvironmentService();
    const second = getEnvironmentService();
    expect(second).toBe(first);

    resetEnvironmentService();
    expect(getEnvironmentService()).not.toBe(first);
  });
});
