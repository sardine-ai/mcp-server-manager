/**
 * Version Banner - Displays update notification when a new version is available
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/index.js";

interface VersionBannerProps {
  currentVersion: string;
  latestVersion: string;
  installCommand: string;
}

export function VersionBanner({
  currentVersion,
  latestVersion,
  installCommand,
}: VersionBannerProps): React.ReactElement {
  const { theme } = useTheme();

  return (
    <Box
      paddingX={2}
      paddingY={0}
      borderStyle="round"
      borderColor={theme.colors.warning}
      flexDirection="row"
      gap={1}
    >
      <Text color={theme.colors.warning} bold>
        ⚠
      </Text>
      <Text>
        New version available: <Text bold color={theme.colors.warning}>{currentVersion}</Text>
        {" → "}
        <Text bold color={theme.colors.success}>{latestVersion}</Text>
      </Text>
      <Text dimColor>|</Text>
      <Text dimColor>Run:</Text>
      <Text color={theme.colors.accent}>{installCommand}</Text>
    </Box>
  );
}

export default VersionBanner;
