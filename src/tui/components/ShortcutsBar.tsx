/**
 * ShortcutsBar component - Bottom shortcuts bar with grouped layout
 */

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme/index.js";

export interface Shortcut {
  key: string;
  label: string;
}

export interface ShortcutGroup {
  shortcuts: Shortcut[];
}

interface ShortcutsBarProps {
  shortcuts?: Shortcut[];
  groups?: ShortcutGroup[];
}

const defaultShortcuts: Shortcut[] = [
  { key: "F", label: "Profiles" },
  { key: "I", label: "Import/Export" },
  { key: "H", label: "Doctor" },
];

export function ShortcutsBar({ shortcuts = defaultShortcuts, groups }: ShortcutsBarProps): React.ReactElement {
  const { theme } = useTheme();
  const renderShortcut = (shortcut: Shortcut) => (
    <Box key={shortcut.key} marginRight={1}>
      <Text color={theme.colors.primary} bold>
        {shortcut.key}
      </Text>
      <Text dimColor> {shortcut.label}</Text>
    </Box>
  );

  if (groups) {
    return (
      <Box paddingX={1} paddingY={0}>
        <Box flexWrap="wrap" gap={0}>
          {groups.map((group, groupIdx) => (
            <Box key={groupIdx} gap={0}>
              {group.shortcuts.map(renderShortcut)}
              {groupIdx < groups.length - 1 && (
                <Box marginRight={1}>
                  <Text dimColor>|</Text>
                </Box>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Box paddingX={1} paddingY={0} borderStyle="round" borderColor="gray" width="100%">
      <Box flexWrap="wrap">
        {shortcuts.map(renderShortcut)}
      </Box>
    </Box>
  );
}

export default ShortcutsBar;
