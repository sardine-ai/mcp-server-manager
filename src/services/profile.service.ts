/**
 * Profile service - manages server profiles
 */

import fs from "fs";
import type {
  Profile,
  ProfilesConfig,
  ProfileListItem,
  ProfileResult,
  ProfileServers,
} from "../types/index.js";
import { getConfigService } from "./config.service.js";
import { createLogger } from "../shared/logger.js";
import { protectExistingPrivateFile, writePrivateJsonFile } from "../shared/secure-storage.js";

const log = createLogger("ProfileService");

/** Default profiles configuration */
const DEFAULT_PROFILES: ProfilesConfig = {
  activeProfile: "default",
  profiles: {
    default: {
      name: "Default",
      servers: [],
      remoteServers: [],
    },
  },
};

/** Profile service class */
export class ProfileService {
  private profilesPath: string;
  private profiles: ProfilesConfig;

  constructor() {
    const configService = getConfigService();
    this.profilesPath = configService.getPaths().profilesPath;
    this.profiles = this.load();
  }

  /** Load profiles from file */
  private load(): ProfilesConfig {
    try {
      if (fs.existsSync(this.profilesPath)) {
        protectExistingPrivateFile(this.profilesPath);
        const data = fs.readFileSync(this.profilesPath, "utf8");
        const parsed = JSON.parse(data) as Partial<ProfilesConfig>;
        return { ...DEFAULT_PROFILES, ...parsed };
      }
    } catch (error) {
      log.debug("Failed to load profiles, using defaults:", error);
    }
    return { ...DEFAULT_PROFILES };
  }

  /** Save profiles to file */
  private save(): void {
    writePrivateJsonFile(this.profilesPath, this.profiles);
  }

  /** Get active profile ID */
  getActiveProfileId(): string {
    return this.profiles.activeProfile;
  }

  /** Get active profile */
  getActiveProfile(): Profile | undefined {
    return this.profiles.profiles[this.profiles.activeProfile];
  }

  /** Get profile by ID */
  getProfile(id: string): Profile | undefined {
    return this.profiles.profiles[id];
  }

  /** List all profiles */
  list(): ProfileListItem[] {
    return Object.entries(this.profiles.profiles).map(([id, profile]) => ({
      id,
      name: profile.name,
      serverCount: profile.servers.length + profile.remoteServers.length,
      isActive: id === this.profiles.activeProfile,
      includesAll: profile.servers.length === 0 && profile.remoteServers.length === 0,
    }));
  }

  /** Create a new profile */
  create(id: string, name?: string): ProfileResult {
    if (this.profiles.profiles[id]) {
      return { success: false, error: "Profile already exists" };
    }

    this.profiles.profiles[id] = {
      name: name || id,
      servers: [],
      remoteServers: [],
    };

    this.save();
    return { success: true };
  }

  /** Clone a profile */
  clone(sourceId: string, newId: string, newName?: string): ProfileResult {
    const source = this.profiles.profiles[sourceId];
    if (!source) {
      return { success: false, error: "Source profile not found" };
    }

    if (this.profiles.profiles[newId]) {
      return { success: false, error: "Profile already exists" };
    }

    // Deep clone the profile
    this.profiles.profiles[newId] = {
      name: newName || `${source.name} (Copy)`,
      servers: [...source.servers],
      remoteServers: [...source.remoteServers],
      toolFilters: source.toolFilters ? JSON.parse(JSON.stringify(source.toolFilters)) : undefined,
    };

    this.save();
    return { success: true };
  }

  /** Delete a profile */
  delete(id: string): ProfileResult {
    if (id === this.profiles.activeProfile) {
      return { success: false, error: "Cannot delete active profile" };
    }

    if (!this.profiles.profiles[id]) {
      return { success: false, error: "Profile not found" };
    }

    delete this.profiles.profiles[id];

    this.save();
    return { success: true };
  }

  /** Switch to a profile */
  use(id: string): ProfileResult {
    if (!this.profiles.profiles[id]) {
      return { success: false, error: "Profile not found" };
    }

    this.profiles.activeProfile = id;
    this.save();
    return { success: true };
  }

  /** Add server to profile */
  addServer(profileId: string, serverId: string): ProfileResult {
    const profile = this.profiles.profiles[profileId];
    if (!profile) {
      return { success: false, error: "Profile not found" };
    }

    const configService = getConfigService();
    const serverResult = configService.findServer(serverId);

    if (!serverResult) {
      return { success: false, error: "Server not found" };
    }

    if (serverResult.type === "local") {
      if (!profile.servers.includes(serverId)) {
        profile.servers.push(serverId);
      }
    } else {
      if (!profile.remoteServers.includes(serverId)) {
        profile.remoteServers.push(serverId);
      }
    }

    this.save();
    return { success: true };
  }

  /** Remove server from profile */
  removeServer(profileId: string, serverId: string): ProfileResult {
    const profile = this.profiles.profiles[profileId];
    if (!profile) {
      return { success: false, error: "Profile not found" };
    }

    profile.servers = profile.servers.filter((id) => id !== serverId);
    profile.remoteServers = profile.remoteServers.filter((id) => id !== serverId);

    this.save();
    return { success: true };
  }

  /** Get servers for active profile */
  getServersForActiveProfile(): ProfileServers {
    const configService = getConfigService();
    const profile = this.getActiveProfile();

    if (!profile) {
      return {
        servers: configService.getLocalServers(),
        remoteServers: configService.getRemoteServers(),
      };
    }

    // Empty arrays mean "include all"
    if (profile.servers.length === 0 && profile.remoteServers.length === 0) {
      return {
        servers: configService.getLocalServers(),
        remoteServers: configService.getRemoteServers(),
      };
    }

    return {
      servers: configService.getLocalServers().filter((s) => profile.servers.includes(s.id)),
      remoteServers: configService
        .getRemoteServers()
        .filter((s) => profile.remoteServers.includes(s.id)),
    };
  }

  /** Get servers for a specific profile */
  getServersForProfile(profileId: string): ProfileServers | null {
    const profile = this.getProfile(profileId);
    if (!profile) {
      return null;
    }

    const configService = getConfigService();

    // Empty arrays mean "include all"
    if (profile.servers.length === 0 && profile.remoteServers.length === 0) {
      return {
        servers: configService.getLocalServers(),
        remoteServers: configService.getRemoteServers(),
      };
    }

    return {
      servers: configService.getLocalServers().filter((s) => profile.servers.includes(s.id)),
      remoteServers: configService
        .getRemoteServers()
        .filter((s) => profile.remoteServers.includes(s.id)),
    };
  }

  /** Rename a profile */
  rename(id: string, newName: string): ProfileResult {
    const profile = this.profiles.profiles[id];
    if (!profile) {
      return { success: false, error: "Profile not found" };
    }

    profile.name = newName;
    this.save();
    return { success: true };
  }

  /** Convert "include all" profile to explicit server lists */
  makeExplicit(profileId: string): void {
    const profile = this.profiles.profiles[profileId];
    if (!profile) return;
    if (profile.servers.length > 0 || profile.remoteServers.length > 0) return;
    const configService = getConfigService();
    profile.servers = configService.getLocalServers().map((s) => s.id);
    profile.remoteServers = configService.getRemoteServers().map((s) => s.id);
    this.save();
  }

  /** Reload profiles from disk */
  reload(): void {
    this.profiles = this.load();
  }

  /** Check if profile exists */
  exists(id: string): boolean {
    return !!this.profiles.profiles[id];
  }
}

/** Singleton instance */
let instance: ProfileService | null = null;

/** Get or create the profile service instance */
export function getProfileService(): ProfileService {
  if (!instance) {
    instance = new ProfileService();
  }
  return instance;
}

/** Reset the singleton instance (for testing) */
export function resetProfileService(): void {
  instance = null;
}

export default ProfileService;
