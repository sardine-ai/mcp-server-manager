/**
 * Feature registry - Single source of truth for CLI/TUI feature parity
 *
 * This file defines all features that should be available in both CLI and TUI.
 * The parity test uses this to verify both interfaces implement all features.
 */

/** Feature category */
export type FeatureCategory =
  | "servers"
  | "tools"
  | "clients"
  | "profiles"
  | "settings"
  | "daemon"
  | "import-export"
  | "utilities"
  | "auth";

/** Feature definition */
export interface Feature {
  /** Unique feature ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Feature category */
  category: FeatureCategory;
  /** CLI command(s) that implement this feature */
  cliCommands: string[];
  /** TUI implementation identifier (screen file or key binding) */
  tuiImplementation: string | null;
  /** Whether this feature is required in TUI (some CLI-only features are OK) */
  requiredInTui: boolean;
}

/**
 * All features that should have CLI/TUI parity
 */
export const FEATURES: Feature[] = [
  // === Servers ===
  {
    id: "server-list",
    name: "List servers",
    category: "servers",
    cliCommands: ["list"],
    tuiImplementation: "main-screen",
    requiredInTui: true,
  },
  {
    id: "server-add",
    name: "Add server",
    category: "servers",
    cliCommands: ["add"],
    tuiImplementation: "AddServerScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "server-remove",
    name: "Remove server",
    category: "servers",
    cliCommands: ["remove"],
    tuiImplementation: "key:d",
    requiredInTui: true,
  },
  {
    id: "server-edit",
    name: "Edit server",
    category: "servers",
    cliCommands: ["edit"],
    tuiImplementation: "key:e",
    requiredInTui: true,
  },
  {
    id: "server-test",
    name: "Test server(s)",
    category: "servers",
    cliCommands: ["test"],
    tuiImplementation: "key:x",
    requiredInTui: true,
  },
  {
    id: "server-enable-disable",
    name: "Enable/disable server",
    category: "servers",
    cliCommands: ["profile add", "profile remove"],
    tuiImplementation: "key:space",
    requiredInTui: true,
  },

  // === Tools ===
  {
    id: "tools-list",
    name: "List tools",
    category: "tools",
    cliCommands: ["tools list"],
    tuiImplementation: "ToolsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "tools-discover",
    name: "Discover tools",
    category: "tools",
    cliCommands: ["tools discover"],
    tuiImplementation: "ToolsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "tools-enable-disable",
    name: "Enable/disable tool",
    category: "tools",
    cliCommands: ["tools enable", "tools disable"],
    tuiImplementation: "ToolsScreen.tsx",
    requiredInTui: true,
  },

  // === Clients ===
  {
    id: "clients-list",
    name: "List clients",
    category: "clients",
    cliCommands: ["clients list"],
    tuiImplementation: "ClientsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "clients-connect-disconnect",
    name: "Connect/disconnect clients",
    category: "clients",
    cliCommands: ["clients connect", "clients disconnect"],
    tuiImplementation: "ClientsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "clients-scope",
    name: "Global or project client configuration",
    category: "clients",
    cliCommands: ["clients connect --scope", "clients list --scope", "clients disconnect --scope", "clients open --scope"],
    tuiImplementation: "ClientsScreen.tsx (S key)",
    requiredInTui: true,
  },
  {
    id: "clients-open",
    name: "Open client config",
    category: "clients",
    cliCommands: ["clients open"],
    tuiImplementation: null, // CLI-only is OK
    requiredInTui: false,
  },

  // === Profiles ===
  {
    id: "profiles-list",
    name: "List profiles",
    category: "profiles",
    cliCommands: ["profile list"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-create",
    name: "Create profile",
    category: "profiles",
    cliCommands: ["profile create"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-delete",
    name: "Delete profile",
    category: "profiles",
    cliCommands: ["profile delete"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-use",
    name: "Switch profile",
    category: "profiles",
    cliCommands: ["profile use"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-add-server",
    name: "Add server to profile",
    category: "profiles",
    cliCommands: ["profile add"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-remove-server",
    name: "Remove server from profile",
    category: "profiles",
    cliCommands: ["profile remove"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-rename",
    name: "Rename profile",
    category: "profiles",
    cliCommands: ["profile rename"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-clone",
    name: "Clone profile",
    category: "profiles",
    cliCommands: ["profile clone"],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "profiles-tool-filters",
    name: "Profile tool filters",
    category: "profiles",
    cliCommands: [],
    tuiImplementation: "ProfilesScreen.tsx",
    requiredInTui: false,
  },

  // === Settings ===
  {
    id: "settings-list",
    name: "List settings",
    category: "settings",
    cliCommands: ["settings list"],
    tuiImplementation: "SettingsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "settings-get-set",
    name: "Get/set setting",
    category: "settings",
    cliCommands: ["settings get", "settings set"],
    tuiImplementation: "SettingsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "settings-port",
    name: "Configure port",
    category: "settings",
    cliCommands: ["port"],
    tuiImplementation: "key:p",
    requiredInTui: true,
  },

  // === Daemon ===
  {
    id: "daemon-start-stop",
    name: "Start/stop daemon",
    category: "daemon",
    cliCommands: ["daemon start", "daemon stop"],
    tuiImplementation: "DaemonScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "daemon-status",
    name: "Daemon status",
    category: "daemon",
    cliCommands: ["daemon status"],
    tuiImplementation: "DaemonScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "daemon-logs",
    name: "View daemon logs",
    category: "daemon",
    cliCommands: ["daemon logs"],
    tuiImplementation: "DaemonScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "daemon-startup",
    name: "Configure auto-start",
    category: "daemon",
    cliCommands: ["daemon startup enable", "daemon startup disable"],
    tuiImplementation: "DaemonScreen.tsx",
    requiredInTui: true,
  },

  // === Import/Export ===
  {
    id: "import",
    name: "Import servers",
    category: "import-export",
    cliCommands: ["import"],
    tuiImplementation: "ImportExportScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "export",
    name: "Export servers",
    category: "import-export",
    cliCommands: ["export"],
    tuiImplementation: "ImportExportScreen.tsx",
    requiredInTui: true,
  },

  // === Utilities ===
  {
    id: "doctor",
    name: "Health check",
    category: "utilities",
    cliCommands: ["doctor"],
    tuiImplementation: "DoctorScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "config-path",
    name: "Show config path",
    category: "utilities",
    cliCommands: ["config"],
    tuiImplementation: "SettingsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "tokens",
    name: "Token usage report",
    category: "utilities",
    cliCommands: ["tokens"],
    tuiImplementation: "ToolsScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "version",
    name: "Show version",
    category: "utilities",
    cliCommands: ["version"],
    tuiImplementation: null,
    requiredInTui: false,
  },

  // === Auth ===
  {
    id: "auth-status",
    name: "Auth status",
    category: "auth",
    cliCommands: ["auth status"],
    tuiImplementation: "AuthScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "auth-login",
    name: "OAuth login",
    category: "auth",
    cliCommands: ["auth login", "auth login-all"],
    tuiImplementation: "AuthScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "auth-logout",
    name: "OAuth logout",
    category: "auth",
    cliCommands: ["auth logout"],
    tuiImplementation: "AuthScreen.tsx",
    requiredInTui: true,
  },
  {
    id: "auth-refresh",
    name: "Refresh OAuth token",
    category: "auth",
    cliCommands: ["auth refresh"],
    tuiImplementation: "AuthScreen.tsx",
    requiredInTui: true,
  },
];

/**
 * Get features missing TUI implementation
 */
export function getMissingTuiFeatures(): Feature[] {
  return FEATURES.filter((f) => f.requiredInTui && !f.tuiImplementation);
}

/**
 * Get features by category
 */
export function getFeaturesByCategory(category: FeatureCategory): Feature[] {
  return FEATURES.filter((f) => f.category === category);
}

/**
 * Get parity status summary
 */
export function getParityStatus(): {
  total: number;
  implemented: number;
  missing: number;
  optional: number;
  percentage: number;
} {
  const required = FEATURES.filter((f) => f.requiredInTui);
  const implemented = required.filter((f) => f.tuiImplementation !== null);
  const optional = FEATURES.filter((f) => !f.requiredInTui);

  return {
    total: FEATURES.length,
    implemented: implemented.length,
    missing: required.length - implemented.length,
    optional: optional.length,
    percentage: Math.round((implemented.length / required.length) * 100),
  };
}
