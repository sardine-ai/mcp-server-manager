import fs from "fs";
import path from "path";

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
  fs.writeFileSync(filePath, contents, { mode: PRIVATE_FILE_MODE });
  applyPrivateMode(filePath, PRIVATE_FILE_MODE);
}

export function writePrivateJsonFile(filePath: string, value: unknown): void {
  writePrivateFile(filePath, JSON.stringify(value, null, 2));
}

export function protectExistingPrivateFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    applyPrivateMode(filePath, PRIVATE_FILE_MODE);
  }
}
