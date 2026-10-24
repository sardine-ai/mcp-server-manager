/**
 * SettingsScreen - Manage application settings (ink component)
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { spawnSync } from "child_process";
import { ScreenLayout } from "../components/index.js";
import { createMenuSections } from "../utils/menu.js";
import { getSettingsService } from "../../services/settings.service.js";
import { changeGatewayPort } from "../../services/gateway-port.service.js";
import { getConfigService } from "../../services/config.service.js";
import type { Settings } from "../../types/index.js";
import { useTheme } from "../theme/index.js";

type View = "list" | "edit" | "confirmReset" | "saving";

interface SettingsScreenProps {
  onBack: () => void;
  initialKey?: keyof Settings;
}

interface SettingsState {
  settings: Settings;
  keys: (keyof Settings)[];
  currentIndex: number;
  view: View;
  editValue: string;
  message: string | null;
  messageType: "success" | "error" | "info";
}

export function SettingsScreen({ onBack, initialKey }: SettingsScreenProps): React.ReactElement {
  const { theme } = useTheme();
  const settingsService = getSettingsService();
  const configService = getConfigService();
  const mounted = useRef(true);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      mounted.current = false;
      clearTimeout(messageTimer.current);
    },
    []
  );

  const allKeys = settingsService.getKeys();
  const initialIndex = initialKey ? Math.max(0, allKeys.indexOf(initialKey)) : 0;

  const [state, setState] = useState<SettingsState>({
    settings: settingsService.getAll(),
    keys: allKeys,
    currentIndex: initialIndex,
    view: "list",
    editValue: "",
    message: null,
    messageType: "info",
  });

  // Show temporary message
  const showMessage = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info", persistent = false) => {
      if (!mounted.current) return;
      clearTimeout(messageTimer.current);
      setState((prev) => ({ ...prev, message: msg, messageType: type }));
      if (persistent) return;
      messageTimer.current = setTimeout(() => {
        setState((prev) => ({ ...prev, message: null }));
      }, 2000);
    },
    []
  );

  // Handle edit setting
  const handleEditSetting = useCallback(
    async (value: string) => {
      const key = state.keys[state.currentIndex];
      if (!key) {
        setState((prev) => ({ ...prev, view: "list", editValue: "" }));
        return;
      }

      if (value.trim()) {
        setState((prev) => ({ ...prev, view: "saving" }));
        try {
          const result =
            key === "port"
              ? await changeGatewayPort(Number(value))
              : settingsService.set(key, value.trim());
          showMessage(
            result.success ? "Setting updated" : result.error || "Failed to update setting",
            result.success ? "success" : "error",
            "warnings" in result && result.warnings.length > 0
          );
        } catch (error) {
          showMessage(error instanceof Error ? error.message : String(error), "error");
        }
      }

      if (!mounted.current) return;
      setState((prev) => ({
        ...prev,
        settings: settingsService.getAll(),
        view: "list",
        editValue: "",
      }));
    },
    [state.keys, state.currentIndex, settingsService, showMessage]
  );

  // Handle reset all
  const handleResetAll = useCallback(
    async (confirm: boolean) => {
      if (confirm) {
        setState((prev) => ({ ...prev, view: "saving" }));
        try {
          const result = await changeGatewayPort(Number(settingsService.getInfo().port.default));
          if (result.success) settingsService.reset();
          showMessage(
            result.success
              ? "Settings reset to defaults"
              : result.error || "Port update incomplete",
            result.success ? "success" : "error",
            result.warnings.length > 0
          );
        } catch (error) {
          showMessage(error instanceof Error ? error.message : String(error), "error");
        }
        if (!mounted.current) return;
        setState((prev) => ({
          ...prev,
          settings: settingsService.getAll(),
          view: "list",
        }));
      } else {
        setState((prev) => ({ ...prev, view: "list" }));
      }
    },
    [settingsService, showMessage]
  );

  // Handle keyboard input
  useInput((input, key) => {
    const { keys, currentIndex, view, settings } = state;
    if (view === "saving") return;

    // Handle confirm reset view
    if (view === "confirmReset") {
      if (input === "y" || input === "Y") {
        handleResetAll(true);
      } else if (input === "n" || input === "N" || key.escape) {
        handleResetAll(false);
      }
      return;
    }

    // Handle edit view
    if (view === "edit") {
      if (key.escape) {
        setState((prev) => ({ ...prev, view: "list", editValue: "" }));
      }
      return;
    }

    // List view
    // Quit
    if (input === "q" || key.escape) {
      onBack();
      return;
    }

    // Navigation - Up
    if (key.upArrow) {
      setState((prev) => ({
        ...prev,
        currentIndex: (currentIndex - 1 + keys.length) % keys.length,
      }));
      return;
    }

    // Navigation - Down
    if (key.downArrow) {
      setState((prev) => ({
        ...prev,
        currentIndex: (currentIndex + 1) % keys.length,
      }));
      return;
    }

    // Toggle boolean / Edit - Space or Enter
    if (input === " " || key.return) {
      const settingKey = keys[currentIndex];
      if (!settingKey) return;

      const currentValue = settings[settingKey];

      if (typeof currentValue === "boolean") {
        // Toggle boolean
        settingsService.set(settingKey, !currentValue);
        setState((prev) => ({
          ...prev,
          settings: settingsService.getAll(),
        }));
      } else {
        // Check for options (static or dynamic)
        const options = settingsService.getOptions(settingKey);
        if (options && options.length > 0) {
          // Cycle through options
          const currentIdx = options.indexOf(String(currentValue));
          const nextIdx = (currentIdx + 1) % options.length;
          settingsService.set(settingKey, options[nextIdx]);
          setState((prev) => ({
            ...prev,
            settings: settingsService.getAll(),
          }));
        } else {
          // Open edit view
          setState((prev) => ({
            ...prev,
            view: "edit",
            editValue: String(currentValue),
          }));
        }
      }
      return;
    }

    // Reset all - R
    if (input.toLowerCase() === "r") {
      setState((prev) => ({ ...prev, view: "confirmReset" }));
      return;
    }

    // Show config path - C
    if (input.toLowerCase() === "c") {
      const paths = configService.getPaths();
      showMessage(`Config: ${paths.configPath}`, "info");
      return;
    }

    // Open config in editor - O
    if (input.toLowerCase() === "o") {
      const paths = configService.getPaths();
      const editor = settingsService.get("editor");
      try {
        spawnSync(editor, [paths.configPath], { stdio: "ignore" });
        showMessage(`Opened ${paths.configPath} in ${editor}`, "success");
      } catch {
        showMessage(`Failed to open ${paths.configPath}`, "error");
      }
      return;
    }
  });

  const { settings, keys, currentIndex, view, editValue, message, messageType } = state;
  const info = settingsService.getInfo();

  const settingsMenuSections = createMenuSections({
    actions: [
      { key: "Enter", label: "Edit" },
      { key: "Space", label: "Toggle" },
      { key: "R", label: "Reset all" },
      { key: "C", label: "Show config path" },
      { key: "O", label: "Open config" },
    ],
    showData: false,
    showConfig: false,
    showSystem: false,
  });

  if (view === "saving") {
    return (
      <ScreenLayout title="Settings" menuSections={settingsMenuSections}>
        <Text>Updating settings...</Text>
      </ScreenLayout>
    );
  }

  // Edit view
  if (view === "edit") {
    const settingKey = keys[currentIndex];
    return (
      <ScreenLayout title="Edit Setting" menuSections={settingsMenuSections}>
        <Box flexDirection="column" paddingY={1}>
          <Text>{settingKey}:</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={editValue}
              onChange={(value) => setState((prev) => ({ ...prev, editValue: value }))}
              onSubmit={handleEditSetting}
            />
          </Box>
        </Box>

        <Box marginTop={2}>
          <Text dimColor>ENTER to save, ESC to cancel</Text>
        </Box>
      </ScreenLayout>
    );
  }

  // Confirm reset view
  if (view === "confirmReset") {
    return (
      <ScreenLayout title="Reset Settings" menuSections={settingsMenuSections}>
        <Box flexDirection="column" paddingY={1}>
          <Text color={theme.colors.warning}>Reset all settings to defaults?</Text>
          <Box marginTop={1}>
            <Text>Press Y to confirm, N to cancel</Text>
          </Box>
        </Box>
      </ScreenLayout>
    );
  }

  // List view
  return (
    <ScreenLayout title="Settings" menuSections={settingsMenuSections}>
      {message && (
        <Box marginBottom={1}>
          <Text
            color={
              messageType === "success"
                ? theme.colors.success
                : messageType === "error"
                  ? theme.colors.error
                  : theme.colors.warning
            }
          >
            {messageType === "success" ? "✓" : messageType === "error" ? "✗" : "ℹ"} {message}
          </Text>
        </Box>
      )}

      {keys.map((settingKey, idx) => {
        const isCurrent = idx === currentIndex;
        const value = settings[settingKey];
        const settingInfo = info[settingKey];
        const isDefault = settingsService.isDefault(settingKey);

        let valueDisplay: React.ReactElement;
        if (typeof value === "boolean") {
          valueDisplay = (
            <Text color={value ? theme.colors.success : theme.colors.error}>
              {value ? "true" : "false"}
            </Text>
          );
        } else {
          valueDisplay = <Text color={theme.colors.primary}>{String(value)}</Text>;
        }

        return (
          <Box key={settingKey} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text color={isCurrent ? theme.colors.highlightText : theme.colors.border}>
                {isCurrent ? "→" : " "}
              </Text>
              <Text color={isCurrent ? theme.colors.highlightText : undefined} bold={isCurrent}>
                {settingKey}:
              </Text>
              {valueDisplay}
              {isDefault && <Text dimColor>(default)</Text>}
            </Box>
            {settingInfo?.description && (
              <Box marginLeft={4}>
                <Text dimColor>{settingInfo.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </ScreenLayout>
  );
}

export default SettingsScreen;
