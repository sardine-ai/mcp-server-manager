/**
 * ClientsScreen - Manage MCP client connections (ink component)
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import os from "os";
import { ScreenLayout } from "../components/index.js";
import { createMenuSections } from "../utils/menu.js";
import { ClientService, getClientService } from "../../services/client.service.js";
import type { DetectedClient } from "../../types/index.js";
import { useTheme } from "../theme/index.js";

/** Convert absolute path to use ~ for home directory */
function shortenPath(path: string): string {
  const homeDir = os.homedir();
  if (path.startsWith(homeDir)) {
    return path.replace(homeDir, "~");
  }
  return path;
}

interface ClientsScreenProps {
  onBack: () => void;
  currentProfileId?: string;
}

interface ClientsState {
  clients: DetectedClient[];
  currentIndex: number;
  connecting: boolean;
  message: string | null;
  messageType: "success" | "error" | "info";
}

export function ClientsScreen({ onBack, currentProfileId }: ClientsScreenProps): React.ReactElement {
  const { theme } = useTheme();
  const [projectScope, setProjectScope] = useState(false);
  const clientService = useMemo(
    () => (projectScope ? new ClientService(process.cwd()) : getClientService()),
    [projectScope]
  );

  const [state, setState] = useState<ClientsState>({
    clients: clientService.detectClients(currentProfileId),
    currentIndex: 0,
    connecting: false,
    message: null,
    messageType: "info",
  });

  // Show temporary message
  const showMessage = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info") => {
      setState((prev) => ({ ...prev, message: msg, messageType: type }));
      setTimeout(() => {
        setState((prev) => ({ ...prev, message: null }));
      }, 2000);
    },
    []
  );

  // Handle connect/disconnect toggle for the current profile
  const handleToggleConnection = useCallback(async () => {
    const { clients, currentIndex, connecting } = state;
    if (connecting || clients.length === 0) return;

    const client = clients[currentIndex];
    if (client.status === "not-installed") return;

    setState((prev) => ({ ...prev, connecting: true }));

    let message: string;
    let messageType: "success" | "error";

    if (client.status === "connected") {
      const result = clientService.disconnectClient(client.id, currentProfileId);
      message = result.success ? "Disconnected" : result.error || "Failed to disconnect";
      messageType = result.success ? "success" : "error";
    } else {
      const result = clientService.connectClient(client.id, currentProfileId);
      message = result.success ? "Connected" : result.error || "Failed to connect";
      messageType = result.success ? "success" : "error";
    }

    setState((prev) => ({
      ...prev,
      connecting: false,
      clients: clientService.detectClients(currentProfileId),
      message,
      messageType,
    }));
  }, [state, clientService, currentProfileId]);

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setState((prev) => ({
      ...prev,
      clients: clientService.detectClients(currentProfileId),
      message: "Refreshed",
      messageType: "info",
    }));
  }, [clientService, currentProfileId]);

  // Handle keyboard input
  useInput((input, key) => {
    const { clients, currentIndex, connecting } = state;

    // Don't process input while connecting
    if (connecting) return;

    // Quit
    if (input === "q" || key.escape) {
      onBack();
      return;
    }

    if (input.toLowerCase() === "s") {
      const nextProjectScope = !projectScope;
      const service = nextProjectScope ? new ClientService(process.cwd()) : getClientService();
      setProjectScope(nextProjectScope);
      setState((prev) => ({
        ...prev,
        clients: service.detectClients(currentProfileId),
        currentIndex: 0,
        message: null,
      }));
      return;
    }

    // Navigation - Up
    if (key.upArrow && clients.length > 0) {
      setState((prev) => ({
        ...prev,
        currentIndex: (currentIndex - 1 + clients.length) % clients.length,
      }));
      return;
    }

    // Navigation - Down
    if (key.downArrow && clients.length > 0) {
      setState((prev) => ({
        ...prev,
        currentIndex: (currentIndex + 1) % clients.length,
      }));
      return;
    }

    // Connect/Disconnect - Enter
    if (key.return && clients.length > 0) {
      handleToggleConnection();
      return;
    }

    // Open config - O
    if ((input === "o" || input === "O") && clients.length > 0) {
      const client = clients[currentIndex];
      if (client.status === "not-installed") {
        showMessage("Client not installed", "error");
        return;
      }
      const result = clientService.openClientConfig(client.id);
      showMessage(
        result.success ? `Opened ${client.name} config` : result.error || "Failed to open config",
        result.success ? "success" : "error"
      );
      return;
    }

    // Refresh - R
    if (input === "r" || input === "R") {
      handleRefresh();
      return;
    }
  });

  const { clients, currentIndex, connecting, message, messageType } = state;

  const clientsMenuSections = createMenuSections({
    actions: [
      { key: "Enter", label: "Connect/Disconnect" },
      { key: "O", label: "Open config" },
      { key: "R", label: "Refresh" },
      { key: "S", label: "Global/Current folder" },
    ],
    showData: false,
    showConfig: false,
    showSystem: false,
  });

  // Show connecting spinner
  if (connecting) {
    return (
      <ScreenLayout title={currentProfileId ? `MCP Clients — ${currentProfileId}` : "MCP Clients"} menuSections={clientsMenuSections}>
        <Box paddingY={1} gap={1}>
          <Text color={theme.colors.primary}>
            <Spinner type="dots" />
          </Text>
          <Text>Updating client connection...</Text>
        </Box>
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout
      title={currentProfileId ? `MCP Clients — ${currentProfileId}` : "MCP Clients"}
      menuSections={clientsMenuSections}
      footer={
        message ? (
          <Text
            color={messageType === "success" ? theme.colors.success : messageType === "error" ? theme.colors.error : theme.colors.warning}
          >
            {messageType === "success" ? "✓" : messageType === "error" ? "✗" : "ℹ"} {message}
          </Text>
        ) : undefined
      }
    >
      <Text dimColor>
        Scope: {projectScope ? `Current folder (${process.cwd()})` : "Global"} · S to switch
      </Text>
      {clients.length === 0 ? (
        <Text dimColor>No clients detected.</Text>
      ) : (
        clients.map((client, idx) => {
          const isCurrent = idx === currentIndex;

          // Status icon and color based on connection status
          let statusIcon: string;
          let statusColor: "green" | "yellow" | "gray";
          let statusText: string;

          if (client.status === "connected") {
            statusIcon = "✔";
            statusColor = "green";
            statusText = "connected";
          } else if (client.status === "disconnected") {
            statusIcon = "○";
            statusColor = "yellow";
            statusText = "disconnected";
          } else {
            statusIcon = "✗";
            statusColor = "gray";
            statusText = "not installed";
          }

          return (
            <Box key={client.id} flexDirection="column" marginBottom={1}>
              {/* First line: arrow, icon, name, status, servers */}
              <Box gap={1}>
                <Text color={isCurrent ? theme.colors.highlightText : theme.colors.primary}>{isCurrent ? "→" : " "}</Text>
                <Text color={statusColor}>{statusIcon}</Text>
                <Text color={isCurrent ? theme.colors.highlightText : undefined} bold={isCurrent}>
                  {client.name}
                </Text>
                <Text dimColor>[{client.id}]</Text>
                <Text dimColor>-</Text>
                <Text color={statusColor}>{statusText}</Text>
                <Text dimColor>-</Text>
                <Text dimColor>
                  {client.serverCount} {client.serverCount === 1 ? "server" : "servers"}
                </Text>
              </Box>
              {/* Second line: config path (prefer real-time path, fallback to primary) */}
              {(client.mcpConfigPath || client.configPath) && (
                <Box marginLeft={3}>
                  <Text dimColor>{shortenPath(client.mcpConfigPath || client.configPath || "")}</Text>
                </Box>
              )}
            </Box>
          );
        })
      )}
    </ScreenLayout>
  );
}

export default ClientsScreen;
