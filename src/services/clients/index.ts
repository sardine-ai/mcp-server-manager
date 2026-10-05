/**
 * Client Strategy Registry
 * Manages client strategy instances and provides factory functions
 */

import type { ClientId } from "../../types/index.js";
import type { IClientStrategy } from "../../types/client-strategy.types.js";

// Strategy imports
import { ClaudeStrategy } from "./claude.strategy.js";
import { CursorStrategy } from "./cursor.strategy.js";
import { WindsurfStrategy } from "./windsurf.strategy.js";
import { KiroStrategy } from "./kiro.strategy.js";
import { VSCodeStrategy } from "./vscode.strategy.js";
import { ClaudeCodeStrategy } from "./claude-code.strategy.js";
import { CodexStrategy } from "./codex.strategy.js";
import { GeminiStrategy } from "./gemini.strategy.js";
import { ZedStrategy } from "./zed.strategy.js";
import { AntigravityStrategy } from "./antigravity.strategy.js";
import { OpenCodeStrategy } from "./opencode.strategy.js";

/**
 * Strategy factory - creates strategy instances
 */
const strategyFactories: Record<ClientId, (projectDir?: string) => IClientStrategy> = {
  claude: (projectDir) => new ClaudeStrategy(projectDir),
  cursor: (projectDir) => new CursorStrategy(projectDir),
  windsurf: (projectDir) => new WindsurfStrategy(projectDir),
  kiro: (projectDir) => new KiroStrategy(projectDir),
  vscode: (projectDir) => new VSCodeStrategy(projectDir),
  "claude-code": (projectDir) => new ClaudeCodeStrategy(projectDir),
  codex: (projectDir) => new CodexStrategy(projectDir),
  gemini: (projectDir) => new GeminiStrategy(projectDir),
  zed: (projectDir) => new ZedStrategy(projectDir),
  antigravity: (projectDir) => new AntigravityStrategy(projectDir),
  opencode: (projectDir) => new OpenCodeStrategy(projectDir),
};

/**
 * Strategy cache - lazy initialization
 */
const strategyCache = new Map<ClientId, IClientStrategy>();

/**
 * Get a strategy instance for a client
 */
export function getClientStrategy(clientId: ClientId, projectDir?: string): IClientStrategy | null {
  if (!strategyFactories[clientId]) {
    return null;
  }

  if (projectDir) return strategyFactories[clientId](projectDir);

  let strategy = strategyCache.get(clientId);
  if (!strategy) {
    strategy = strategyFactories[clientId]();
    strategyCache.set(clientId, strategy);
  }

  return strategy;
}

/**
 * Get all registered client IDs
 */
export function getRegisteredClientIds(): ClientId[] {
  return Object.keys(strategyFactories) as ClientId[];
}

/**
 * Register a new client strategy (for extensibility)
 */
export function registerClientStrategy(clientId: string, factory: () => IClientStrategy): void {
  (strategyFactories as Record<string, () => IClientStrategy>)[clientId] = factory;
  // Clear cache for this client if it exists
  strategyCache.delete(clientId as ClientId);
}

/**
 * Clear strategy cache (useful for testing)
 */
export function clearStrategyCache(): void {
  strategyCache.clear();
}
