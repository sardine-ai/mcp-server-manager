import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

const supportsPosixModes = process.platform !== "win32";

export function applyPrivateMode(filePath: string, mode: number): void {
  if (!supportsPosixModes) return;
  fs.chmodSync(filePath, mode);
}

export function ensurePrivateDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  applyPrivateMode(dirPath, PRIVATE_DIR_MODE);
}

export function writePrivateFile(filePath: string, contents: string): void {
  ensurePrivateDirectory(path.dirname(filePath));
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { mode: PRIVATE_FILE_MODE, flag: "wx" });
    applyPrivateMode(temporaryPath, PRIVATE_FILE_MODE);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {
      // Cleanup must not mask the original write failure.
    }
  }
}

export function readPrivateJsonFile<T>(filePath: string) {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error(
      `Cannot read configuration at ${filePath}. Check the file and its permissions.`
    );
  }
  try {
    const value = JSON.parse(contents) as T;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    protectExistingPrivateFile(filePath);
    return value;
  } catch {
    throw new Error(
      `Cannot load configuration at ${filePath}. Fix the file or move it aside and retry.`
    );
  }
}

export function writePrivateJsonFile(filePath: string, value: unknown): void {
  writePrivateFile(filePath, JSON.stringify(value, null, 2));
}

export function protectExistingPrivateFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    applyPrivateMode(filePath, PRIVATE_FILE_MODE);
  }
}
