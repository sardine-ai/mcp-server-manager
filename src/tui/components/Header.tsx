/**
 * Header component - App title and status
 */

import React from "react";
import { Box, Text } from "ink";
import { formatTokens, formatSwitchable } from "../../shared/formatters.js";
import { useTheme } from "../theme/index.js";

interface HeaderProps {
  title?: string;
  version?: string;
  profile?: string;
  port?: number;
  totalTokens?: number | null;
  trailing?: React.ReactNode;
}

export function Header({
  title = "MCP Server Manager",
  version,
  profile,
  port,
  totalTokens,
  trailing,
}: HeaderProps): React.ReactElement {
  const { theme } = useTheme();

  const subtitleParts: string[] = [];
  if (profile) subtitleParts.push(`Profile: ${formatSwitchable(profile)}`);
  if (port) subtitleParts.push(`Port: ${port}`);
  if (totalTokens !== undefined) {
    const tokensLabel =
      typeof totalTokens === "number" ? `${formatTokens(totalTokens)} tokens` : "— tokens";
    subtitleParts.push(`Total: ${tokensLabel}`);
  }

  return (
    <Box paddingX={2} paddingY={0} borderStyle="round" borderColor={theme.colors.headerBorder} flexDirection="column">
      <Box gap={1}>
        <Text color={theme.colors.primary} bold>
          {title} {version && `v${version}`}
        </Text>
        {trailing}
      </Box>
      {subtitleParts.length > 0 && <Text dimColor>{subtitleParts.join(" | ")}</Text>}
    </Box>
  );
}

export default Header;
