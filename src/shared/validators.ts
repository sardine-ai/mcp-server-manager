/**
 * Input validation utilities
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate port number
 * @param port - Port number to validate
 * @returns Validation result with error message if invalid
 */
export function validatePort(port: number): ValidationResult {
  if (!Number.isInteger(port)) {
    return { valid: false, error: "Port must be an integer" };
  }

  if (port < 1 || port > 65535) {
    return { valid: false, error: "Port must be between 1 and 65535" };
  }

  if (port < 1024) {
    return {
      valid: true, // Warning only, still valid
      error: `Port ${port} is a privileged port (< 1024) and may require elevated permissions`,
    };
  }

  return { valid: true };
}

/**
 * Validate URL for remote servers
 * @param url - URL to validate
 * @returns Validation result with error message if invalid
 */
export function validateUrl(url: string): ValidationResult {
  if (!url || url.trim() === "") {
    return { valid: false, error: "URL cannot be empty" };
  }

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, error: "URL must use http or https protocol" };
    }

    if (!parsed.hostname) {
      return { valid: false, error: "URL must have a valid hostname" };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }
}

/** Hosts that mean "this machine", where plain http is acceptable. */
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether an OAuth endpoint URL is safe to call: https, or http on this machine.
 * Discovery metadata is supplied by the remote server, so a plain-http or
 * off-origin endpoint is rejected before any request carries a secret to it.
 */
export function isSafeAuthUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && LOOPBACK_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Whether two URLs share scheme, host and port. */
export function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Validate server ID format
 * @param id - Server ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateServerId(id: string): ValidationResult {
  if (!id || id.trim() === "") {
    return { valid: false, error: "Server ID cannot be empty" };
  }

  if (id.length > 64) {
    return { valid: false, error: "Server ID cannot exceed 64 characters" };
  }

  // Allow alphanumeric, dash, underscore
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(id)) {
    return {
      valid: false,
      error: "Server ID can only contain letters, numbers, dashes, and underscores",
    };
  }

  return { valid: true };
}

/**
 * Validate server name
 * @param name - Server name to validate
 * @returns Validation result with error message if invalid
 */
export function validateServerName(name: string): ValidationResult {
  if (!name || name.trim() === "") {
    return { valid: false, error: "Server name cannot be empty" };
  }

  if (name.length > 128) {
    return { valid: false, error: "Server name cannot exceed 128 characters" };
  }

  return { valid: true };
}

/**
 * Validate command path for local servers
 * @param command - Command to validate
 * @returns Validation result with error message if invalid
 */
export function validateCommand(command: string): ValidationResult {
  if (!command || command.trim() === "") {
    return { valid: false, error: "Command cannot be empty" };
  }

  // Check for potentially dangerous shell metacharacters in command
  const dangerousChars = /[;&|`$(){}[\]<>]/;
  if (dangerousChars.test(command)) {
    return {
      valid: false,
      error: "Command contains potentially unsafe shell metacharacters",
    };
  }

  return { valid: true };
}

/**
 * Generate a safe server ID from name
 * @param name - Server name to convert
 * @returns Safe server ID
 */
export function generateServerId(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
}

/**
 * Validate profile ID format
 * @param id - Profile ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateProfileId(id: string): ValidationResult {
  if (!id || id.trim() === "") {
    return { valid: false, error: "Profile ID cannot be empty" };
  }

  if (id.length > 64) {
    return { valid: false, error: "Profile ID cannot exceed 64 characters" };
  }

  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(id)) {
    return {
      valid: false,
      error: "Profile ID can only contain letters, numbers, dashes, and underscores",
    };
  }

  return { valid: true };
}
