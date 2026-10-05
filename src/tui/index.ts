#!/usr/bin/env node
/**
 * TUI - Interactive Terminal User Interface
 * Main entry point for the interactive mode (ink-based)
 */

import React from "react";
import { render } from "ink";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { ThemeProvider } from "./theme/index.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("TUI");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (error): void => {
        log.error("Mutation error:", error);
      },
    },
  },
});

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_SCREEN = "\x1b[2J";
const CURSOR_HOME = "\x1b[H";

function enableAlternateScreen(): void {
  process.stdout.write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}${CLEAR_SCREEN}${CURSOR_HOME}`);
}

function disableAlternateScreen(): void {
  process.stdout.write(`${CLEAR_SCREEN}${CURSOR_HOME}${SHOW_CURSOR}${EXIT_ALT_SCREEN}`);
}

/** Start the TUI */
export async function startTui(): Promise<void> {
  // Clear terminal before rendering TUI (gemini-cli behavior)
  process.stdout.write("\x1B[2J\x1B[0f");

  const shouldUseAlternateScreen = process.env.MCPSM_ALT_SCREEN === "1";
  if (shouldUseAlternateScreen) {
    enableAlternateScreen();
  }

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (shouldUseAlternateScreen) {
      disableAlternateScreen();
    }
  };

  const signals = ["SIGINT", "SIGTERM"] as const;
  type SignalName = (typeof signals)[number];

  const handleSignal = (signal: SignalName): void => {
    cleanup();
    // Re-emit signal with default behavior after cleanup
    process.kill(process.pid, signal);
  };

  signals.forEach((signal) => process.once(signal, handleSignal));
  process.once("exit", cleanup);

  // Proxy stdout to report rows=0, which forces Ink to use its full-screen
  // clearTerminal path instead of eraseLines. The eraseLines approach (cursor up +
  // erase line) doesn't work reliably in all terminal emulators (e.g. Conductor),
  // causing ghost/duplicate renders. The clearTerminal path (\x1b[2J\x1b[3J\x1b[H)
  // is universally supported.
  const stdoutProxy = new Proxy(process.stdout, {
    get(target, prop, receiver): unknown {
      if (prop === "rows") return 0;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });

  const { waitUntilExit } = render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ThemeProvider, null, React.createElement(App))
    ),
    { stdout: stdoutProxy }
  );

  try {
    await waitUntilExit();
  } finally {
    signals.forEach((signal) => process.removeListener(signal, handleSignal));
    cleanup();
  }
}

export default startTui;
