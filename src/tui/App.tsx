/**
 * Main TUI Application - Ink-based terminal UI
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import Spinner from "ink-spinner";
import { Header, ShortcutsBar, ConfirmDialog, ScrollableList, ScreenLayout, VersionBanner, DaemonStatus } from "./components/index.js";
import { getConfigService } from "../services/config.service.js";
import { getTestingService } from "../services/testing.service.js";
import { getProfileService } from "../services/profile.service.js";
import { getDaemonService } from "../services/daemon.service.js";
import { getAuthService } from "../services/auth.service.js";
import { getVersionService } from "../services/version.service.js";
import { createLogger } from "../shared/logger.js";
import { formatTokens } from "../shared/formatters.js";
import type { LocalServer, RemoteServer, ServerToolFilter, Settings } from "../types/index.js";
import { VERSION } from "../shared/version.js";
import { getEnabledTokenTotal } from "./utils/tokenTotals.js";

const log = createLogger("App");

// Screen components
import { AddServerScreen } from "./screens/AddServerScreen.js";
import { ToolsScreen } from "./screens/ToolsScreen.js";
import { ClientsScreen } from "./screens/ClientsScreen.js";
import { ProfilesScreen } from "./screens/ProfilesScreen.js";
import { SettingsScreen } from "./screens/SettingsScreen.js";
import { DaemonScreen } from "./screens/DaemonScreen.js";
import { ImportExportScreen } from "./screens/ImportExportScreen.js";
import { DoctorScreen } from "./screens/DoctorScreen.js";
import { AuthScreen } from "./screens/AuthScreen.js";
import { EditServerScreen } from "./screens/EditServerScreen.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useTheme } from "./theme/index.js";

type Screen =
  | "main"
  | "add-server"
  | "edit-server"
  | "tools"
  | "clients"
  | "profiles"
  | "settings"
  | "daemon"
  | "import-export"
  | "doctor"
  | "auth"
  | "testing";

interface UnifiedServer {
  server: LocalServer | RemoteServer;
  type: "local" | "remote";
  id: string; // For local: server.id, for remote: `remote:${server.id}`
}

interface AppState {
  screen: Screen;
  currentIndex: number;
  currentProfileIndex: number;
  toolCounts: Map<string, number>;
  serversNeedingAuth: Set<string>; // Remote server IDs that need authentication
  localServers: LocalServer[];
  remoteServers: RemoteServer[];
  message: string | null;
  messageType: "success" | "error" | "info";
  testResults: Array<{
    name: string;
    type: string;
    success: boolean;
    toolCount?: number;
    error?: string;
    requiresAuth?: boolean;
  }> | null;
  testingTotal: number; // Total servers being tested
  testingCompleted: number; // Servers completed
  authServerId?: string; // Server to auth when going to auth screen
  confirmDelete?: { server: LocalServer | RemoteServer; type: "local" | "remote" }; // Server pending deletion confirmation
  editTarget?: { server: LocalServer | RemoteServer; type: "local" | "remote" };
  settingsInitialKey?: keyof Settings;
  versionInfo?: { current: string; latest: string; hasUpdate: boolean; installCommand: string };
}

interface AppProps {
  onExit?: () => void;
}

function filterIndicatesAuth(filter?: ServerToolFilter): boolean {
  if (!filter?.error) return false;
  const message = filter.error.toLowerCase();
  return (
    message.includes("auth") ||
    message.includes("unauthorized") ||
    message.includes("401")
  );
}

export function App({ onExit }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { theme } = useTheme();
  const configService = getConfigService();
  const profileService = getProfileService();
  const daemonService = getDaemonService();
  const terminalSize = useTerminalSize();
  const isCompactLayout = terminalSize.columns < 90;
  const contentMargin = isCompactLayout ? 0 : 1;

  const [state, setState] = useState<AppState>(() => {
    const localServers = configService.getLocalServers().map((server) => ({ ...server }));
    const remoteServers = configService.getRemoteServers().map((server) => ({ ...server }));

    return {
      screen: "main",
      currentIndex: 0,
      currentProfileIndex: 0,
      toolCounts: new Map<string, number>(),
      serversNeedingAuth: new Set<string>(),
      localServers,
      remoteServers,
      message: null,
      messageType: "info",
      testResults: null,
      testingTotal: 0,
      testingCompleted: 0,
      editTarget: undefined,
      settingsInitialKey: undefined,
    };
  });

  // Refresh servers from config
  const refreshServers = useCallback(() => {
    const newLocalServers = configService.getLocalServers().map((server) => ({ ...server }));
    const newRemoteServers = configService.getRemoteServers().map((server) => ({ ...server }));

    setState((prev) => ({
      ...prev,
      localServers: newLocalServers,
      remoteServers: newRemoteServers,
    }));
  }, []);

  // Show temporary message
  const [messageTimeoutId, setMessageTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(
    null
  );

  const showMessage = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info") => {
      setState((prev) => ({ ...prev, message: msg, messageType: type }));
      const timeoutId = setTimeout(() => {
        setState((prev) => ({ ...prev, message: null }));
      }, 2000);
      setMessageTimeoutId(timeoutId);
    },
    []
  );

  // Cleanup message timeout on unmount
  useEffect(() => {
    return () => {
      if (messageTimeoutId) {
        clearTimeout(messageTimeoutId);
      }
    };
  }, [messageTimeoutId]);

  const refreshDaemonIfRunning = useCallback(
    (context: string) => {
      if (daemonService.isDaemonRunning().running) {
        daemonService.refreshDaemon().catch((error) => {
          log.error(`Failed to refresh daemon after ${context}:`, error);
        });
      }
    },
    [daemonService]
  );

  // Load tool counts and auth status on mount
  useEffect(() => {
    let isMounted = true;

    const loadToolCountsAndAuthStatus = async (): Promise<void> => {
      const testingService = getTestingService();
      const authService = getAuthService();

      // First try to load from cached tool filters
      const toolFilters = configService.getToolFilters();
      const newToolCounts = new Map<string, number>();

      for (const server of state.localServers) {
        const filter = toolFilters[server.id];
        if (filter?.allTools) {
          newToolCounts.set(server.id, filter.allTools.length);
        }
      }

      for (const server of state.remoteServers) {
        const filter = toolFilters[`remote:${server.id}`];
        if (filter?.allTools) {
          newToolCounts.set(`remote:${server.id}`, filter.allTools.length);
        }
      }

      // Check which remote servers need authentication
      const needsAuth = new Set<string>();
      for (const server of state.remoteServers) {
        const filter = toolFilters[`remote:${server.id}`];
        if (server.oauth?.enabled) {
          if (authService.isRefreshable(server.id)) {
            authService.getValidToken(server).then((refreshed) => {
              if (refreshed && isMounted) {
                setState((prev) => {
                  const newNeedsAuth = new Set(prev.serversNeedingAuth);
                  newNeedsAuth.delete(server.id);
                  return { ...prev, serversNeedingAuth: newNeedsAuth };
                });
              }
            });
          } else if (!authService.hasValidToken(server.id)) {
            needsAuth.add(server.id);
          }
        } else if (filterIndicatesAuth(filter)) {
          needsAuth.add(server.id);
        }
      }

      if (!isMounted) return;
      setState((prev) => ({ ...prev, toolCounts: newToolCounts, serversNeedingAuth: needsAuth }));

      // Auto-test unknown servers in background
      await testingService.autoTestUnknownServers();

      if (!isMounted) return;

      // Reload tool counts after testing
      const updatedFilters = configService.getToolFilters();
      const finalToolCounts = new Map<string, number>();

      for (const server of state.localServers) {
        const filter = updatedFilters[server.id];
        if (filter?.allTools) {
          finalToolCounts.set(server.id, filter.allTools.length);
        }
      }

      for (const server of state.remoteServers) {
        const filter = updatedFilters[`remote:${server.id}`];
        if (filter?.allTools) {
          finalToolCounts.set(`remote:${server.id}`, filter.allTools.length);
        }
      }

      // Re-check auth status after testing
      const finalNeedsAuth = new Set<string>();
      for (const server of state.remoteServers) {
        const filter = updatedFilters[`remote:${server.id}`];
        if (server.oauth?.enabled) {
          if (authService.isRefreshable(server.id)) {
            authService.getValidToken(server).then((refreshed) => {
              if (refreshed && isMounted) {
                setState((prev) => {
                  const newNeedsAuth = new Set(prev.serversNeedingAuth);
                  newNeedsAuth.delete(server.id);
                  return { ...prev, serversNeedingAuth: newNeedsAuth };
                });
              }
            });
          } else if (!authService.hasValidToken(server.id)) {
            finalNeedsAuth.add(server.id);
          }
        } else if (filterIndicatesAuth(filter)) {
          finalNeedsAuth.add(server.id);
        }
      }

      if (!isMounted) return;
      setState((prev) => ({ ...prev, toolCounts: finalToolCounts, serversNeedingAuth: finalNeedsAuth }));
      refreshDaemonIfRunning("auto-testing servers");
    };

    loadToolCountsAndAuthStatus();

    return () => {
      isMounted = false;
    };
  }, [refreshDaemonIfRunning]);

  // Check for version updates on mount
  useEffect(() => {
    let isMounted = true;

    const checkVersion = async (): Promise<void> => {
      const versionService = getVersionService();
      try {
        const versionInfo = await versionService.checkForUpdate();
        if (isMounted && versionInfo.hasUpdate) {
          setState((prev) => ({ ...prev, versionInfo }));
        }
      } catch (error) {
        log.debug("Failed to check version:", error);
      }
    };

    checkVersion();

    return () => {
      isMounted = false;
    };
  }, []);

  // Create unified server list
  const unifiedServers = React.useMemo((): UnifiedServer[] => {
    const servers: UnifiedServer[] = [];
    state.localServers.forEach((server) => {
      servers.push({ server, type: "local", id: server.id });
    });
    state.remoteServers.forEach((server) => {
      servers.push({ server, type: "remote", id: `remote:${server.id}` });
    });
    return servers;
  }, [refreshDaemonIfRunning, state.localServers, state.remoteServers]);

  // Get current server
  const getCurrentServer = useCallback((): {
    server: LocalServer | RemoteServer | null;
    type: "local" | "remote";
  } => {
    const unified = unifiedServers[state.currentIndex];
    if (unified) {
      return { server: unified.server, type: unified.type };
    }
    return { server: null, type: "local" };
  }, [state.currentIndex, unifiedServers]);

  // Refresh auth status for all remote servers
  const refreshAuthStatus = useCallback(() => {
    const authService = getAuthService();
    const needsAuth = new Set<string>();
    for (const server of state.remoteServers) {
      if (
        server.oauth?.enabled &&
        !authService.hasValidToken(server.id) &&
        !authService.isRefreshable(server.id)
      ) {
        needsAuth.add(server.id);
      }
    }
    setState((prev) => ({ ...prev, serversNeedingAuth: needsAuth }));
  }, [state.remoteServers]);

  // Navigate back to main screen
  const goBack = useCallback(() => {
    refreshServers();
    refreshAuthStatus();
    setState((prev) => ({
      ...prev,
      screen: "main",
      testResults: null,
      testingTotal: 0,
      testingCompleted: 0,
      editTarget: undefined,
      settingsInitialKey: undefined,
    }));
  }, [refreshServers, refreshAuthStatus]);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(() => {
    setState((prev) => {
      const { confirmDelete } = prev;
      if (!confirmDelete) return prev;

      const { server, type } = confirmDelete;
      const serverToDeleteId = type === "remote" ? `remote:${server.id}` : server.id;
      
      // Build current unified list to find index
      const currentUnified: UnifiedServer[] = [];
      prev.localServers.forEach((s) => {
        currentUnified.push({ server: s, type: "local", id: s.id });
      });
      prev.remoteServers.forEach((s) => {
        currentUnified.push({ server: s, type: "remote", id: `remote:${s.id}` });
      });
      const deleteIndex = currentUnified.findIndex((u) => u.id === serverToDeleteId);
      
      const result =
        type === "local"
          ? configService.removeLocalServer(server.id)
          : configService.removeRemoteServer(server.id);

      if (result.success) {
        showMessage(`Server '${server.name}' deleted`, "success");
        // Refresh daemon if running (auto-sync)
        refreshDaemonIfRunning("deleting server");
        
        // Get fresh server lists after deletion - create new arrays to ensure React detects the change
        // Force reload by creating new arrays with new object references
        const freshLocal = configService.getLocalServers();
        const freshRemote = configService.getRemoteServers();
        const newLocal = freshLocal.map((s) => ({ ...s }));
        const newRemote = freshRemote.map((s) => ({ ...s }));
        const total = newLocal.length + newRemote.length;
        let newIndex = prev.currentIndex;
        
        // If we deleted the current item or an item before it, adjust the index
        if (deleteIndex >= 0) {
          if (deleteIndex < prev.currentIndex) {
            // Deleted item was before current, so current index shifts down
            newIndex = prev.currentIndex - 1;
          } else if (deleteIndex === prev.currentIndex) {
            // Deleted the current item, stay at same index (which now points to next item)
            // or move to previous if we're at the end
            newIndex = Math.min(prev.currentIndex, total - 1);
          }
        }
        
        // Ensure index is valid
        if (total === 0) {
          newIndex = 0;
        } else if (newIndex >= total) {
          newIndex = Math.max(0, total - 1);
        }

        return {
          ...prev,
          localServers: newLocal,
          remoteServers: newRemote,
          currentIndex: newIndex,
          confirmDelete: undefined,
        };
      } else {
        showMessage(result.error || "Failed to delete", "error");
        return { ...prev, confirmDelete: undefined };
      }
    });
  }, [refreshDaemonIfRunning, showMessage]);

  // Handle delete cancellation
  const handleDeleteCancel = useCallback(() => {
    setState((prev) => ({ ...prev, confirmDelete: undefined }));
  }, []);

  // Run test all servers with streaming results
  const runTestAllServers = useCallback(async () => {
    const testingService = getTestingService();
    const localCount = state.localServers.length;
    const remoteCount = state.remoteServers.length;
    const total = localCount + remoteCount;

    // Initialize with empty results array for all servers
    const initialResults = [
      ...state.localServers.map((s) => ({
        name: s.name,
        type: "stdio" as string,
        success: false,
        testing: true,
      })),
      ...state.remoteServers.map((s) => ({
        name: s.name,
        type: s.type as string,
        success: false,
        testing: true,
      })),
    ];

    setState((prev) => ({
      ...prev,
      screen: "testing",
      testResults: initialResults as typeof prev.testResults,
      testingTotal: total,
      testingCompleted: 0,
    }));

    // Track which servers have been updated
    const serverOrder = [
      ...state.localServers.map((s) => s.name),
      ...state.remoteServers.map((s) => s.name),
    ];

    await testingService.testAllServersStreaming(({ server, type, result }) => {
      const serverIndex = serverOrder.indexOf(server.name);

      setState((prev) => {
        const newResults = [...(prev.testResults || [])];
        if (serverIndex >= 0 && serverIndex < newResults.length) {
          newResults[serverIndex] = {
            name: server.name,
            type: type === "remote" ? (server as RemoteServer).type : "stdio",
            success: result.success,
            toolCount: result.toolCount,
            error: result.error,
            requiresAuth: result.requiresAuth,
          };
        }
        let updatedRemoteServers = prev.remoteServers;
        if (type === "remote" && result.requiresAuth) {
          configService.updateRemoteServer(server.id, {
            oauth: { enabled: true },
          });
          updatedRemoteServers = prev.remoteServers.map((s) =>
            s.id === server.id ? { ...s, oauth: { ...(s.oauth || {}), enabled: true } } : s
          );
        }
        return {
          ...prev,
          remoteServers: updatedRemoteServers,
          testResults: newResults,
          testingCompleted: prev.testingCompleted + 1,
        };
      });
    });
    refreshDaemonIfRunning("testing servers");
  }, [state.localServers, state.remoteServers]);

  // Keyboard input handling (only on main screen)
  useInput(
    (input, key) => {
      // Only handle input on main and testing screens
      if (state.screen !== "main" && state.screen !== "testing") return;

      // Handle testing screen
      if (state.screen === "testing") {
        const isComplete = state.testingCompleted >= state.testingTotal && state.testingTotal > 0;

        // Only allow interaction when testing is complete
        if (!isComplete) return;

        // "O" key to open auth screen for servers that need auth
        if (input === "o" || input === "O") {
          const needsAuth = state.testResults?.filter((r) => r.requiresAuth && !r.success) || [];
          if (needsAuth.length > 0) {
            setState((prev) => ({ ...prev, screen: "auth" }));
            return;
          }
        }
        // Any other key to go back
        goBack();
        return;
      }

      const { confirmDelete } = state;

      // Skip input handling when confirmation dialog is active (ConfirmDialog handles its own input)
      if (confirmDelete) {
        return;
      }

      // Quit
      if (input === "q") {
        if (onExit) onExit();
        exit();
        return;
      }

      // Left arrow - switch to previous profile
      if (key.leftArrow) {
        const profiles = profileService.list();
        if (profiles.length > 1) {
          setState((prev) => {
            const prevIdx = prev.currentProfileIndex > 0 ? prev.currentProfileIndex - 1 : profiles.length - 1;
            return { ...prev, currentProfileIndex: prevIdx };
          });
        }
        return;
      }

      // Right arrow - switch to next profile
      if (key.rightArrow) {
        const profiles = profileService.list();
        if (profiles.length > 1) {
          setState((prev) => {
            const nextIdx = prev.currentProfileIndex < profiles.length - 1 ? prev.currentProfileIndex + 1 : 0;
            return { ...prev, currentProfileIndex: nextIdx };
          });
        }
        return;
      }

      // Navigation - Up
      if (key.upArrow) {
        setState((prev) => {
          const total = unifiedServers.length;
          if (total === 0) return prev;
          const newIndex = prev.currentIndex > 0 ? prev.currentIndex - 1 : total - 1;
          return { ...prev, currentIndex: newIndex };
        });
        return;
      }

      // Navigation - Down
      if (key.downArrow) {
        setState((prev) => {
          const total = unifiedServers.length;
          if (total === 0) return prev;
          const newIndex = prev.currentIndex < total - 1 ? prev.currentIndex + 1 : 0;
          return { ...prev, currentIndex: newIndex };
        });
        return;
      }

      // Space - Toggle server membership in current profile
      if (input === " ") {
        const { server, type } = getCurrentServer();
        if (!server) return;

        const profiles = profileService.list();
        const currentProfile = profiles[state.currentProfileIndex];
        if (!currentProfile) return;

        const profileData = profileService.getProfile(currentProfile.id);
        if (!profileData) return;

        const serverId = type === "remote" ? server.id : server.id;
        const isIncludeAll = profileData.servers.length === 0 && profileData.remoteServers.length === 0;
        const isMember = isIncludeAll ||
          (type === "local" ? profileData.servers.includes(serverId) : profileData.remoteServers.includes(serverId));

        if (isMember) {
          if (isIncludeAll) {
            profileService.makeExplicit(currentProfile.id);
          }
          profileService.removeServer(currentProfile.id, serverId);
        } else {
          profileService.addServer(currentProfile.id, serverId);
        }
        setState((prev) => ({ ...prev }));
        refreshDaemonIfRunning("toggling profile membership");
        return;
      }

      // D - Delete server (show confirmation)
      if (input === "d" || input === "D") {
        const { server, type } = getCurrentServer();
        if (server) {
          setState((prev) => ({ ...prev, confirmDelete: { server, type } }));
        }
        return;
      }

      // A - Add server
      if (input === "a" || input === "A") {
        setState((prev) => ({ ...prev, screen: "add-server" }));
        return;
      }

      // E - Edit server
      if (input === "e" || input === "E") {
        const { server, type } = getCurrentServer();
        if (server) {
          setState((prev) => ({ ...prev, screen: "edit-server", editTarget: { server, type } }));
        } else {
          showMessage("No server selected to edit", "info");
        }
        return;
      }

      // X - Test servers
      if (input === "x" || input === "X") {
        runTestAllServers();
        return;
      }

      // T - Tools
      if (input === "t" || input === "T") {
        setState((prev) => ({ ...prev, screen: "tools" }));
        return;
      }

      // C - Clients
      if (input === "c" || input === "C") {
        setState((prev) => ({ ...prev, screen: "clients" }));
        return;
      }

      // F - Profiles
      if (input === "f" || input === "F") {
        setState((prev) => ({ ...prev, screen: "profiles" }));
        return;
      }

      // G - Settings
      if (input === "g" || input === "G") {
        setState((prev) => ({ ...prev, screen: "settings", settingsInitialKey: undefined }));
        return;
      }

      // I - Import/Export
      if (input === "i" || input === "I") {
        setState((prev) => ({ ...prev, screen: "import-export" }));
        return;
      }

      // H - Doctor
      if (input === "h" || input === "H") {
        setState((prev) => ({ ...prev, screen: "doctor" }));
        return;
      }

      // O - OAuth Authentication
      if (input === "o" || input === "O") {
        // Check if current server is remote and needs auth
        const { server, type } = getCurrentServer();
        if (type === "remote" && server) {
          setState((prev) => ({ ...prev, screen: "auth", authServerId: server.id }));
        } else {
          // Open auth screen for all remote servers
          setState((prev) => ({ ...prev, screen: "auth", authServerId: undefined }));
        }
        return;
      }

      // Enter - Open daemon management screen
      if (key.return) {
        // Go to daemon management screen to start/stop daemon
        setState((prev) => ({ ...prev, screen: "daemon" }));
        return;
      }
    },
    { isActive: state.screen === "main" || state.screen === "testing" }
  );

  // Render screen based on current state
  const { screen } = state;

  // Sub-screens
  if (screen === "edit-server" && state.editTarget) {
    const { server, type } = state.editTarget;
    return (
      <EditServerScreen
        server={server}
        type={type}
        onBack={goBack}
        onSaved={(updatedServer) => {
          refreshServers();
          refreshAuthStatus();
          showMessage(`Server '${updatedServer.name}' updated`, "success");
          setState((prev) => ({ ...prev, screen: "main", editTarget: undefined }));
          refreshDaemonIfRunning("editing server");
        }}
      />
    );
  }

  if (screen === "add-server") {
    return <AddServerScreen onBack={goBack} />;
  }

  if (screen === "tools") {
    const { server, type } = getCurrentServer();
    const initialServerId = server ? (type === "remote" ? `remote:${server.id}` : server.id) : undefined;
    return <ToolsScreen onBack={goBack} initialServerId={initialServerId} />;
  }

  if (screen === "clients") {
    const profiles = profileService.list();
    const currentProfile = profiles[state.currentProfileIndex];
    return (
      <ClientsScreen
        onBack={goBack}
        currentProfileId={currentProfile?.id}
        currentProfileName={currentProfile?.name}
        onProfilePrev={() => {
          if (profiles.length > 1) {
            setState((prev) => {
              const prevIdx = prev.currentProfileIndex > 0 ? prev.currentProfileIndex - 1 : profiles.length - 1;
              return { ...prev, currentProfileIndex: prevIdx };
            });
          }
        }}
        onProfileNext={() => {
          if (profiles.length > 1) {
            setState((prev) => {
              const nextIdx = prev.currentProfileIndex < profiles.length - 1 ? prev.currentProfileIndex + 1 : 0;
              return { ...prev, currentProfileIndex: nextIdx };
            });
          }
        }}
      />
    );
  }

  if (screen === "profiles") {
    return <ProfilesScreen onBack={goBack} />;
  }

  if (screen === "settings") {
    return <SettingsScreen onBack={goBack} initialKey={state.settingsInitialKey} />;
  }

  if (screen === "daemon") {
    return <DaemonScreen onBack={goBack} />;
  }

  if (screen === "import-export") {
    return <ImportExportScreen onBack={goBack} />;
  }

  if (screen === "doctor") {
    return <DoctorScreen onBack={goBack} />;
  }

  if (screen === "auth") {
    return (
      <AuthScreen
        onBack={goBack}
        serverId={state.authServerId}
        onAuthComplete={(serverId, success) => {
          if (success) {
            showMessage(`${serverId} authenticated`, "success");
            // Remove from serversNeedingAuth
            setState((prev) => {
              const newNeedsAuth = new Set(prev.serversNeedingAuth);
              newNeedsAuth.delete(serverId);
              return { ...prev, serversNeedingAuth: newNeedsAuth };
            });
          }
        }}
      />
    );
  }

  // Testing screen
  if (screen === "testing") {
    const { testResults, testingTotal, testingCompleted } = state;
    const isComplete = testingCompleted >= testingTotal && testingTotal > 0;
    const needsAuthCount = testResults?.filter((r) => r.requiresAuth && !r.success).length ?? 0;

    const title = isComplete
      ? "Testing Servers - Complete"
      : `Testing Servers (${testingCompleted}/${testingTotal})`;

    return (
      <ScreenLayout
        title={title}
        shortcuts={[
          ...(isComplete && needsAuthCount > 0 ? [{ key: "O", label: "Auth" }] : []),
          { key: "Any", label: "Continue" },
        ]}
        footer={
          isComplete && needsAuthCount > 0 ? (
            <Text color={theme.colors.warning}>
              {needsAuthCount} server(s) need authentication. Press <Text bold>O</Text> to authenticate.
            </Text>
          ) : undefined
        }
      >
        {testResults?.map((result, idx) => {
          const isTesting = (result as { testing?: boolean }).testing;

          return (
            <Box key={idx} gap={1} marginBottom={1}>
              {isTesting ? (
                <>
                  <Text color={theme.colors.info}>
                    <Spinner type="dots" />
                  </Text>
                  <Text dimColor>
                    {result.name}
                    {result.type !== "stdio" ? ` (${result.type})` : ""}
                  </Text>
                </>
              ) : (
                <>
                  <Text color={result.success ? theme.colors.success : result.requiresAuth ? theme.colors.warning : theme.colors.error}>
                    {result.success ? "✓" : result.requiresAuth ? "○" : "✗"}
                  </Text>
                  <Text>
                    {result.name}
                    {result.type !== "stdio" ? ` (${result.type})` : ""}
                  </Text>
                  <Text dimColor>-</Text>
                  <Text color={result.success ? theme.colors.success : result.requiresAuth ? theme.colors.warning : theme.colors.error}>
                    {result.success
                      ? `${result.toolCount} tools`
                      : result.requiresAuth
                        ? "requires auth"
                        : result.error}
                  </Text>
                </>
              )}
            </Box>
          );
        })}
      </ScreenLayout>
    );
  }

  // Main screen
  const {
    localServers,
    remoteServers,
    message,
    messageType,
  } = state;
  const hasServers = localServers.length > 0 || remoteServers.length > 0;
  const profiles = profileService.list();
  const currentProfile = profiles[state.currentProfileIndex];
  const profileData = currentProfile ? profileService.getProfile(currentProfile.id) : null;
  const profileMemberIds = new Set<string>();
  if (profileData) {
    if (profileData.servers.length === 0 && profileData.remoteServers.length === 0) {
      unifiedServers.forEach((u) => profileMemberIds.add(u.id));
    } else {
      profileData.servers.forEach((id) => profileMemberIds.add(id));
      profileData.remoteServers.forEach((id) => profileMemberIds.add(`remote:${id}`));
    }
  }
  const port = configService.getPort();
  const toolFilters = configService.getToolFilters();
  const totalTokens = (() => {
    let total = 0;
    let hasData = false;

    const accumulate = (filterId: string) => {
      const tokens = getEnabledTokenTotal(toolFilters[filterId]);
      if (tokens !== null) {
        total += tokens;
        hasData = true;
      }
    };

    localServers.forEach((server) => {
      if (profileMemberIds.has(server.id)) accumulate(server.id);
    });
    remoteServers.forEach((server) => {
      if (profileMemberIds.has(`remote:${server.id}`)) accumulate(`remote:${server.id}`);
    });

    return hasData ? total : null;
  })();

  return (
    <Box flexDirection="column" paddingX={isCompactLayout ? 0 : 1}>
      <Box marginX={contentMargin}>
        <Header
          title="MCP Server Manager"
          version={VERSION}
          profile={currentProfile?.name}
          port={port}
          totalTokens={totalTokens}
          trailing={<DaemonStatus compact polling />}
        />
      </Box>

      {/* Version update banner */}
      {state.versionInfo?.hasUpdate && (
        <Box marginX={contentMargin} marginTop={1}>
          <VersionBanner
            currentVersion={state.versionInfo.current}
            latestVersion={state.versionInfo.latest}
            installCommand={state.versionInfo.installCommand}
          />
        </Box>
      )}

      {/* Delete confirmation dialog - shown exclusively */}
      {state.confirmDelete ? (
        <Box marginX={contentMargin} marginTop={1}>
          <ConfirmDialog
            title={`Delete Server`}
            description={`Are you sure you want to delete '${state.confirmDelete.server.name}'? This action cannot be undone.`}
            confirmText="Yes, delete"
            cancelText="No, keep it"
            titleColor="red"
            onConfirm={handleDeleteConfirm}
            onCancel={handleDeleteCancel}
          />
        </Box>
      ) : (
        <>
          {/* Message */}
          {message && (
            <Box marginX={contentMargin} marginTop={1}>
              <Text
                color={messageType === "success" ? theme.colors.success : messageType === "error" ? theme.colors.error : theme.colors.warning}
              >
                {messageType === "success" ? "✓" : messageType === "error" ? "✗" : "ℹ"} {message}
              </Text>
            </Box>
          )}

          {/* Main content: Unified server list */}
          <Box marginTop={1} flexDirection="column" marginX={contentMargin}>
            {hasServers ? (
              <Box
                flexDirection="column"
                paddingX={1}
              >
                {unifiedServers.length > 0 ? (
                  <ScrollableList
                    items={unifiedServers}
                    selectedIndex={state.currentIndex}
                    emptyMessage="No servers configured."
                    renderItem={(unified, idx) => {
                      const isCurrent = idx === state.currentIndex;
                      const { server, type, id } = unified;
                      const isEnabled = profileMemberIds.has(id);
                      const filter = toolFilters[id];
                      const totalTools = filter?.allTools?.length ?? 0;
                      const disabledCount = filter?.disabledTools?.length ?? 0;
                      const enabledTools = totalTools - disabledCount;
                      const tokenTotal = getEnabledTokenTotal(filter);
                      const tokenLabel = tokenTotal !== null ? `${formatTokens(tokenTotal)} tokens` : "— tokens";
                      const needsAuth = type === "remote" && state.serversNeedingAuth.has(server.id);
                      const serverType = type === "local" ? "stdio" : (server as RemoteServer).type || "http";

                      const nameColor = isCurrent ? theme.colors.highlightText : !isEnabled ? theme.colors.disabled : undefined;
                      const arrowColor = isCurrent
                        ? theme.colors.serverArrowSelected
                        : type === "local"
                          ? theme.colors.serverArrowLocal
                          : theme.colors.serverArrowRemote;
                      const metaColor = isCurrent ? theme.colors.highlightText : !isEnabled ? theme.colors.disabled : theme.colors.accent;
                      const dimColor = isCurrent ? theme.colors.highlightText : undefined;

                      return (
                        <Box key={id} gap={1} paddingX={1}>
                          <Text color={arrowColor} bold={isCurrent}>{isCurrent ? "→" : " "}</Text>
                          <Text color={isEnabled ? theme.colors.serverCheckEnabled : theme.colors.serverCheckDisabled}>
                            {isEnabled ? "[✓]" : "[ ]"}
                          </Text>
                          <Text color={nameColor} bold={isCurrent}>
                            {server.name || server.id}
                          </Text>
                          {type !== "local" && (
                            <Text color={isCurrent ? theme.colors.highlightText : theme.colors.disabled}>[{serverType}]</Text>
                          )}
                          <>
                            <Text color={needsAuth ? theme.colors.serverNeedsAuth : !isEnabled ? theme.colors.disabled : theme.colors.serverStatus}>
                              {needsAuth ? "!" : "✓"}
                            </Text>
                            <Text color={metaColor}>
                              {enabledTools}/{totalTools} tools
                            </Text>
                            <Text color={dimColor} dimColor={!isCurrent}>·</Text>
                            <Text color={metaColor}>{tokenLabel}</Text>
                            {filter?.error && (
                              <>
                                <Text color={dimColor} dimColor={!isCurrent}>·</Text>
                                <Text color={theme.colors.serverStatusError}>{filter.error}</Text>
                              </>
                            )}
                            {needsAuth && (
                              <>
                                <Text color={dimColor} dimColor={!isCurrent}>·</Text>
                                <Text color={theme.colors.serverNeedsAuth}>needs auth</Text>
                              </>
                            )}
                          </>
                        </Box>
                      );
                    }}
                  />
                ) : (
                  <Text dimColor>No servers configured.</Text>
                )}
              </Box>
            ) : (
              <Box
                flexDirection="column"
                paddingX={1}
                paddingY={1}
              >
                <Text dimColor>No servers configured. Press <Text color={theme.colors.primary} bold>A</Text> to add a new server.</Text>
              </Box>
            )}
          </Box>

          {/* Bottom shortcuts bar */}
          <Box marginTop={1} flexGrow={1} marginX={contentMargin}>
            <ShortcutsBar
              groups={[
                { shortcuts: [
                  { key: "↑↓", label: "Navigate" },
                  { key: "←→", label: "Profile" },
                ] },
                { shortcuts: [
                  { key: "A", label: "Add" },
                  { key: "E", label: "Edit" },
                  { key: "D", label: "Del" },
                  { key: "Space", label: "Toggle" },
                  { key: "X", label: "Test" },
                ] },
                { shortcuts: [
                  { key: "T", label: "Tools" },
                  { key: "C", label: "Clients" },
                  { key: "F", label: "Profiles" },
                  { key: "G", label: "Settings" },
                ] },
                { shortcuts: [
                  { key: "Enter", label: "Daemon" },
                  { key: "H", label: "Doctor" },
                  { key: "Q", label: "Quit" },
                ] },
              ]}
            />
          </Box>
        </>
      )}
    </Box>
  );
}

export default App;
