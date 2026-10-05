/**
 * ProfilesScreen - Manage server profiles (ink component)
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { ScreenLayout, ConfirmDialog } from "../components/index.js";
import { createMenuSections } from "../utils/menu.js";
import { getProfileService } from "../../services/profile.service.js";
import type { ProfileListItem } from "../../types/index.js";
import { useTheme } from "../theme/index.js";

type View = "list" | "create" | "selectCloneSource" | "rename" | "confirmDelete" | "confirmClone";

interface ProfilesScreenProps {
  onBack: () => void;
}

interface ProfilesState {
  profiles: ProfileListItem[];
  currentIndex: number;
  view: View;
  newProfileName: string;
  renameValue: string;
  message: string | null;
  messageType: "success" | "error" | "info";
  cloneSourceId: string | null;
}

export function ProfilesScreen({ onBack }: ProfilesScreenProps): React.ReactElement {
  const { theme } = useTheme();
  const profileService = getProfileService();

  const [state, setState] = useState<ProfilesState>({
    profiles: profileService.list(),
    currentIndex: 0,
    view: "list",
    newProfileName: "",
    renameValue: "",
    message: null,
    messageType: "info",
    cloneSourceId: null,
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

  // Handle create profile
  const handleCreateProfile = useCallback(
    (name: string, sourceId?: string) => {
      if (!name.trim()) {
        setState((prev) => ({ ...prev, view: "list", newProfileName: "", cloneSourceId: null }));
        return;
      }

      const id = name.toLowerCase().replace(/\s+/g, "-");
      let result;

      if (sourceId) {
        result = profileService.clone(sourceId, id, name.trim());
      } else {
        result = profileService.create(id, name.trim());
      }

      if (result.success) {
        showMessage(`Profile '${name}' ${sourceId ? "cloned" : "created"}`, "success");
        setState((prev) => ({
          ...prev,
          profiles: profileService.list(),
          view: "list",
          newProfileName: "",
          cloneSourceId: null,
        }));
      } else {
        showMessage(result.error || "Failed to create profile", "error");
        setState((prev) => ({ ...prev, view: "list", newProfileName: "", cloneSourceId: null }));
      }
    },
    [profileService, showMessage]
  );

  const handleRenameProfile = useCallback(
    (value: string) => {
      const name = value.trim();
      const profile = state.profiles[state.currentIndex];
      if (!profile || !name) {
        setState((prev) => ({ ...prev, view: "list", renameValue: "" }));
        return;
      }

      const result = profileService.rename(profile.id, name);
      if (result.success) {
        showMessage(`Profile renamed to '${name}'`, "success");
        setState((prev) => ({
          ...prev,
          profiles: profileService.list(),
          view: "list",
          renameValue: "",
        }));
      } else {
        showMessage(result.error || "Failed to rename profile", "error");
        setState((prev) => ({ ...prev, view: "list", renameValue: "" }));
      }
    },
    [profileService, showMessage, state.currentIndex, state.profiles]
  );

  // Handle delete profile
  const handleDeleteProfile = useCallback(
    (confirm: boolean) => {
      if (!confirm) {
        setState((prev) => ({ ...prev, view: "list" }));
        return;
      }

      const profile = state.profiles[state.currentIndex];
      if (!profile) {
        setState((prev) => ({ ...prev, view: "list" }));
        return;
      }

      const result = profileService.delete(profile.id);
      if (result.success) {
        showMessage("Profile deleted", "success");
        setState((prev) => ({
          ...prev,
          profiles: profileService.list(),
          currentIndex: Math.max(0, prev.currentIndex - 1),
          view: "list",
        }));
      } else {
        showMessage(result.error || "Failed to delete profile", "error");
        setState((prev) => ({ ...prev, view: "list" }));
      }
    },
    [state.profiles, state.currentIndex, profileService, showMessage]
  );

  // Handle keyboard input
  useInput((input, key) => {
    const { profiles, currentIndex, view } = state;

    // Skip input handling when confirmation dialog is active (ConfirmDialog handles its own input)
    if (view === "confirmDelete" || view === "confirmClone") {
      return;
    }

    // Handle selectCloneSource view
    if (view === "selectCloneSource") {
      if (key.escape) {
        setState((prev) => ({ ...prev, view: "list", cloneSourceId: null }));
        return;
      }

      if (key.upArrow && profiles.length > 0) {
        setState((prev) => ({
          ...prev,
          currentIndex: (currentIndex - 1 + profiles.length) % profiles.length,
        }));
        return;
      }

      if (key.downArrow && profiles.length > 0) {
        setState((prev) => ({
          ...prev,
          currentIndex: (currentIndex + 1) % profiles.length,
        }));
        return;
      }

      if (key.return && profiles.length > 0) {
        const profile = profiles[currentIndex];
        setState((prev) => ({ ...prev, view: "create", cloneSourceId: profile.id }));
        return;
      }
      return;
    }

    // Handle create/rename view
    if (view === "create" || view === "rename") {
      if (key.escape) {
        setState((prev) => ({ ...prev, view: "list", newProfileName: "", renameValue: "", cloneSourceId: null }));
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
    if (key.upArrow && profiles.length > 0) {
      setState((prev) => ({
        ...prev,
        currentIndex: (currentIndex - 1 + profiles.length) % profiles.length,
      }));
      return;
    }

    // Navigation - Down
    if (key.downArrow && profiles.length > 0) {
      setState((prev) => ({
        ...prev,
        currentIndex: (currentIndex + 1) % profiles.length,
      }));
      return;
    }

    // Add profile - A
    if (input.toLowerCase() === "a") {
      // Show confirmation dialog: Clone or start fresh?
      setState((prev) => ({ ...prev, view: "confirmClone" }));
      return;
    }

    // Rename profile - R
    if (input.toLowerCase() === "r" && profiles.length > 0) {
      const profile = profiles[currentIndex];
      setState((prev) => ({
        ...prev,
        view: "rename",
        renameValue: profile?.name || "",
      }));
      return;
    }

    // Delete profile - D
    if (input.toLowerCase() === "d" && profiles.length > 0) {
      setState((prev) => ({ ...prev, view: "confirmDelete" }));
      return;
    }
  });

  const { profiles, currentIndex, view, newProfileName, renameValue, message, messageType, cloneSourceId } = state;

  // Create profile view
  const profilesMenuSections = createMenuSections({
    actions: [
      { key: "A", label: "Add" },
      { key: "R", label: "Rename" },
      { key: "D", label: "Delete" },
    ],
    showData: false,
    showConfig: false,
    showSystem: false,
  });

  // Confirm clone view
  if (view === "confirmClone") {
    return (
      <ConfirmDialog
        title="New Profile"
        description="Do you want to clone from an existing profile?"
        confirmText="Yes, clone"
        cancelText="No, create empty"
        titleColor="green"
        onConfirm={() => setState((prev) => ({ ...prev, view: "selectCloneSource" }))}
        onCancel={() => setState((prev) => ({ ...prev, view: "create", cloneSourceId: null, newProfileName: "" }))}
      />
    );
  }

  // Select clone source view
  if (view === "selectCloneSource") {
    return (
      <ScreenLayout title="Select Profile to Clone" menuSections={profilesMenuSections}>
        <Box flexDirection="column" paddingY={1}>
          <Box marginBottom={1}>
            <Text>Select a profile to clone from:</Text>
          </Box>
          {profiles.map((profile, idx) => {
            const isCurrent = idx === currentIndex;
            return (
              <Box key={profile.id} marginBottom={1}>
                <Text color={isCurrent ? theme.colors.highlightText : theme.colors.primary}>
                  {isCurrent ? "→" : " "}
                </Text>
                <Text> </Text>
                <Text color={isCurrent ? theme.colors.highlightText : undefined} bold={isCurrent}>
                  {profile.name}
                </Text>
                <Text> </Text>
                <Text dimColor>({profile.serverCount} servers)</Text>
              </Box>
            );
          })}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ to select, Enter to confirm, ESC to cancel</Text>
        </Box>
      </ScreenLayout>
    );
  }

  // Create profile view
  if (view === "create") {
    const sourceProfile = cloneSourceId ? profiles.find(p => p.id === cloneSourceId) : null;
    return (
      <ScreenLayout title={cloneSourceId ? `Clone Profile: ${sourceProfile?.name || ""}` : "Create New Profile"} menuSections={profilesMenuSections}>
        <Box flexDirection="column" paddingY={1}>
          <Text>Profile name:</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={newProfileName}
              onChange={(value) => setState((prev) => ({ ...prev, newProfileName: value }))}
              onSubmit={(name) => handleCreateProfile(name, cloneSourceId || undefined)}
            />
          </Box>
        </Box>
        <Box marginTop={2}>
          <Text dimColor>ENTER to {cloneSourceId ? "clone" : "create"}, ESC to cancel</Text>
        </Box>
      </ScreenLayout>
    );
  }

  // Rename profile view
  if (view === "rename") {
    const profile = profiles[currentIndex];
    return (
      <ScreenLayout title="Rename Profile" menuSections={profilesMenuSections}>
        <Box flexDirection="column" paddingY={1}>
          <Text>New name for '{profile?.name}':</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={renameValue}
              onChange={(value) => setState((prev) => ({ ...prev, renameValue: value }))}
              onSubmit={handleRenameProfile}
            />
          </Box>
        </Box>
        <Box marginTop={2}>
          <Text dimColor>ENTER to save, ESC to cancel</Text>
        </Box>
      </ScreenLayout>
    );
  }

  // Confirm delete view
  if (view === "confirmDelete") {
    const profile = profiles[currentIndex];
    return (
      <ConfirmDialog
        title="Delete Profile"
        description={`Are you sure you want to delete profile '${profile?.name}'? This action cannot be undone.`}
        confirmText="Yes, delete"
        cancelText="No, keep it"
        titleColor="red"
        onConfirm={() => handleDeleteProfile(true)}
        onCancel={() => handleDeleteProfile(false)}
      />
    );
  }

  return (
    <ScreenLayout title="Profiles" menuSections={profilesMenuSections}>
      {message && (
        <Box marginBottom={1}>
          <Text color={messageType === "success" ? theme.colors.success : messageType === "error" ? theme.colors.error : theme.colors.warning}>
            {messageType === "success" ? "✓" : messageType === "error" ? "✗" : "ℹ"} {message}
          </Text>
        </Box>
      )}

      {profiles.length === 0 ? (
        <Text dimColor>No profiles configured.</Text>
      ) : (
        profiles.map((profile, idx) => {
          const isCurrent = idx === currentIndex;
          const serverInfo = profile.includesAll ? "all servers" : `${profile.serverCount} server(s)`;
          const showId = profile.id !== profile.name.toLowerCase().replace(/\s+/g, "-");
          const profileServers = profileService.getServersForProfile(profile.id);
          const serverNames: string[] = [];
          if (profileServers) {
            profileServers.servers.forEach((s) => serverNames.push(s.name));
            profileServers.remoteServers.forEach((s) => serverNames.push(s.name));
          }
          const maxPreview = 4;
          const previewNames = serverNames.slice(0, maxPreview);
          const remaining = serverNames.length - maxPreview;

          return (
            <Box key={profile.id} flexDirection="column" marginBottom={1}>
              <Box gap={1}>
                <Text color={isCurrent ? theme.colors.highlightText : theme.colors.primary}>{isCurrent ? "→" : " "}</Text>
                <Text color={isCurrent ? theme.colors.highlightText : undefined} bold={isCurrent}>
                  {profile.name}
                </Text>
                {showId && <Text dimColor>[{profile.id}]</Text>}
                {profile.isActive && <Text color={theme.colors.success}>(active)</Text>}
                <Text dimColor>{serverInfo}</Text>
              </Box>
              {previewNames.length > 0 && (
                <Box marginLeft={4}>
                  <Text dimColor>
                    {previewNames.join(", ")}{remaining > 0 ? `, +${remaining} more` : ""}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })
      )}
    </ScreenLayout>
  );
}

export default ProfilesScreen;
