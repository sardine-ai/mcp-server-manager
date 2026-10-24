import { afterEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import { runDoctorChecks } from "../src/services/doctor.service.js";

vi.mock("../src/services/config.service.js", () => ({
  getConfigService: vi.fn(() => ({
    getPaths: vi.fn(() => ({ configDir: "/fixture", configPath: "/fixture/config.json" })),
    getLocalServers: vi.fn(() => [{ id: "local" }]),
    getRemoteServers: vi.fn(() => [{ id: "one" }, { id: "two" }]),
  })),
}));
vi.mock("child_process", () => ({ execSync: vi.fn() }));

describe("shared doctor checks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("preserves lookup fallbacks, optional failures, ordering and server counts", () => {
    vi.mocked(execSync).mockImplementation((command) => {
      if (command === "which python" || command === "which npm") return Buffer.from("");
      if (command === "python --version") return "Python fixture";
      throw new Error("unavailable");
    });
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const checks = runDoctorChecks();
    expect(checks.map((check) => check.name)).toEqual([
      "Node.js",
      "Python",
      "uv",
      "uvx",
      "npm",
      "Config directory",
      "Config file",
      "Servers configured",
    ]);
    expect(checks[1]).toEqual({ name: "Python", status: true, info: "Python fixture" });
    expect(checks[2]).toMatchObject({ status: false, info: "not found (optional)" });
    expect(checks[4]).toMatchObject({ status: true, info: "not found" });
    expect(checks[5].status).toBe(false);
    expect(checks[7].info).toBe("3 (1 local, 2 remote)");
  });
});
