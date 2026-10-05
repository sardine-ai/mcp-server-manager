/**
 * ServerList component - Displays servers with selection state
 */

import React from "react";
import { Box, Text } from "ink";
import type { LocalServer, RemoteServer } from "../../types/index.js";
import { useTheme } from "../theme/index.js";

interface ServerListProps {
  title: string;
  servers: (LocalServer | RemoteServer)[];
  selectedIndex: number;
  isActiveSection: boolean;
  selectedServers: Set<string>;
  toolCounts?: Map<string, number>;
  isRemote?: boolean;
}

export function ServerList({
  title,
  servers,
  selectedIndex,
  isActiveSection,
  selectedServers,
  toolCounts = new Map(),
  isRemote = false,
}: ServerListProps): React.ReactElement | null {
  const { theme } = useTheme();

  if (servers.length === 0) return null;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text color={theme.colors.primary} bold>
          {title}
        </Text>
      </Box>

      {servers.map((server, idx) => {
        const isCurrent = isActiveSection && idx === selectedIndex;
        const serverId = isRemote ? `remote:${server.id}` : server.id;
        const isEnabled = selectedServers.has(serverId);
        const toolCount = toolCounts.get(serverId) ?? 0;

        const checkbox = isEnabled ? "[✓]" : "[ ]";
        const checkboxColor = isEnabled ? "green" : "gray";

        const nameColor = isCurrent ? "magenta" : !isEnabled ? "gray" : undefined;

        const statusText = `${toolCount} tools`;
        const statusColor = !isEnabled ? "gray" : undefined;

        return (
          <Box key={server.id} gap={1}>
            <Text color={isCurrent ? theme.colors.highlightText : theme.colors.primary}>{isCurrent ? "→" : " "}</Text>
            <Text color={checkboxColor}>{checkbox}</Text>
            <Text color={nameColor} bold={isCurrent}>
              {server.name || server.id}
            </Text>
            <Text dimColor>-</Text>
            <Text color={statusColor}>{statusText}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export default ServerList;
