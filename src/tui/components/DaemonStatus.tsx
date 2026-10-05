import React from "react";
import { Box, Text } from "ink";
import { useDaemonStatus } from "../hooks/useDaemonStatus.js";
import { useTheme } from "../theme/index.js";

interface DaemonStatusProps {
  compact?: boolean;
  polling?: boolean;
}

export function DaemonStatus({ compact = false, polling = false }: DaemonStatusProps): React.ReactElement {
  const { theme } = useTheme();
  const { status, isLoading } = useDaemonStatus({ polling });

  const renderStatus = (): { indicator: string; color: string; label: string } => {
    if (isLoading || !status) {
      return { indicator: "○", color: theme.colors.info, label: compact ? "Loading..." : "Checking daemon..." };
    }
    if (!status.running) {
      return { indicator: "●", color: theme.colors.error, label: compact ? "Stopped" : "Daemon stopped" };
    }
    if (status.healthy) {
      const srvCount = status.health?.servers ?? 0;
      const toolCount = status.health?.tools ?? 0;
      if (compact) {
        return { indicator: "●", color: theme.colors.success, label: `Healthy (${srvCount} srv, ${toolCount} tools)` };
      }
      return { indicator: "●", color: theme.colors.success, label: `Healthy (PID: ${status.pid}, ${srvCount} servers, ${toolCount} tools)` };
    }
    if (compact) {
      return { indicator: "●", color: theme.colors.warning, label: "Unhealthy" };
    }
    return { indicator: "●", color: theme.colors.warning, label: `Running but unhealthy (PID: ${status.pid})` };
  };

  const { indicator, color, label } = renderStatus();

  return (
    <Box gap={1}>
      <Text color={color}>{indicator}</Text>
      <Text color={color}>{label}</Text>
      {!compact && !isLoading && status && !status.healthy && status.running && (
        <Text color={theme.colors.error}>{status.health?.error || "Not responding"}</Text>
      )}
    </Box>
  );
}
