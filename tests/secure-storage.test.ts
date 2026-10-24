import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPrivateJsonFile, writePrivateJsonFile } from "../src/shared/secure-storage.js";
import { ConfigRepository } from "../src/services/config/config.repository.js";

describe("private persistence", () => {
  let directory: string;
  let file: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-storage-"));
    file = path.join(directory, "config.json");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("distinguishes missing files from invalid or unreadable state", () => {
    expect(readPrivateJsonFile(file)).toBeUndefined();
    fs.writeFileSync(file, "{broken");
    expect(() => readPrivateJsonFile(file)).toThrow(file);
    expect(() => new ConfigRepository(directory)).toThrow(file);
    expect(fs.readFileSync(file, "utf8")).toBe("{broken");
    vi.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw Object.assign(new Error(), { code: "EACCES" });
    });
    expect(() => readPrivateJsonFile(file)).toThrow(file);
  });

  it("keeps the whole prior snapshot after a failed reload", () => {
    const repository = new ConfigRepository(directory);
    repository.updateConfig((config) => {
      config.port = 9000;
    });
    fs.writeFileSync(file, JSON.stringify({ servers: [], remoteServers: [], port: 9100 }));
    fs.writeFileSync(path.join(directory, "tool-filters.json"), "broken");
    expect(() => repository.reload()).toThrow("tool-filters.json");
    expect(repository.getConfig().port).toBe(9000);
  });

  it.each(["writeFileSync", "renameSync"] as const)(
    "preserves the destination and cleans up when %s fails",
    (method) => {
      writePrivateJsonFile(file, { port: 8850 });
      const original = fs.readFileSync(file, "utf8");
      vi.spyOn(fs, method).mockImplementationOnce(() => {
        throw new Error("disk failure");
      });
      expect(() => writePrivateJsonFile(file, { port: 9000 })).toThrow("disk failure");
      expect(fs.readFileSync(file, "utf8")).toBe(original);
      expect(fs.readdirSync(directory)).toEqual(["config.json"]);
    }
  );

  it("does not change memory after a failed replacement", () => {
    const repository = new ConfigRepository(directory);
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("disk failure");
    });
    expect(() =>
      repository.updateConfig((config) => {
        config.port = 9000;
      })
    ).toThrow("disk failure");
    expect(repository.getConfig().port).toBe(8850);
    expect(readPrivateJsonFile<{ port: number }>(file)?.port).toBe(8850);
  });

  it("writes complete private replacements and leaves the destination on serialization failure", () => {
    writePrivateJsonFile(file, { port: 9000 });
    expect(readPrivateJsonFile(file)).toEqual({ port: 9000 });
    expect(() => writePrivateJsonFile(file, { bad: 1n })).toThrow();
    expect(readPrivateJsonFile(file)).toEqual({ port: 9000 });
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    }
  });
});
