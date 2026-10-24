import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { SettingsService, resetSettingsService } from "../src/services/settings.service.js";
import { resetConfigService } from "../src/services/config.service.js";

// Test directory setup
const testConfigDir = path.join(os.tmpdir(), "mcpsm-settings-test-" + Date.now());

describe("SettingsService", () => {
  let settingsService: SettingsService;

  beforeEach(() => {
    process.env.MCP_MANAGER_CONFIG_DIR = testConfigDir;
    resetConfigService();
    resetSettingsService();

    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Write default config (required by settings.js import)
    fs.writeFileSync(
      path.join(testConfigDir, "config.json"),
      JSON.stringify({ servers: [], remoteServers: [], port: 8850 })
    );
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    resetSettingsService();
    resetConfigService();
  });

  describe("getAll", () => {
    it("should return default settings when no file exists", () => {
      settingsService = new SettingsService();

      const settings = settingsService.getAll();
      expect(settings.port).toBe(8850);
      expect(settings.editor).toBeDefined();
    });

    it("prefers the canonical config port over legacy settings", () => {
      fs.writeFileSync(path.join(testConfigDir, "settings.json"), JSON.stringify({ port: 9000 }));

      settingsService = new SettingsService();
      const settings = settingsService.getAll();

      expect(settings.port).toBe(8850);
      // Should merge with defaults
      expect(settings.editor).toBeDefined();
    });
  });

  it.each([undefined, {}, { port: 0 }])(
    "migrates settings-only port when config is %j",
    (config) => {
      if (config === undefined) fs.rmSync(path.join(testConfigDir, "config.json"));
      else fs.writeFileSync(path.join(testConfigDir, "config.json"), JSON.stringify(config));
      fs.writeFileSync(
        path.join(testConfigDir, "settings.json"),
        JSON.stringify({ port: 9100, editor: "nano" })
      );
      const settings = new SettingsService();
      expect(settings.get("port")).toBe(9100);
      settings.set("editor", "vim");
      expect(
        JSON.parse(fs.readFileSync(path.join(testConfigDir, "settings.json"), "utf8"))
      ).toEqual({ editor: "vim" });
    }
  );

  it.each(["9000abc", "9000.5", "", "70000", [9000], true])("rejects invalid port %j", (port) => {
    expect(new SettingsService().set("port", port).success).toBe(false);
  });

  describe("get", () => {
    it("should get a single setting", () => {
      settingsService = new SettingsService();

      const port = settingsService.get("port");
      expect(port).toBe(8850);
    });
  });

  describe("set", () => {
    beforeEach(() => {
      settingsService = new SettingsService();
    });

    it("should set a number setting", () => {
      const result = settingsService.set("port", "9002");
      expect(result.success).toBe(true);
      expect(result.value).toBe(9002);
      expect(settingsService.get("port")).toBe(9002);
    });

    it("should set a string setting with validation", () => {
      const result = settingsService.set("editor", "nano");
      expect(result.success).toBe(true);
      expect(result.value).toBe("nano");
      expect(settingsService.get("editor")).toBe("nano");
    });

    it("should set a string setting", () => {
      const result = settingsService.set("editor", "vim");
      expect(result.success).toBe(true);
      expect(settingsService.get("editor")).toBe("vim");
    });

    it("should reject invalid setting key", () => {
      const result = settingsService.set(
        "invalidKey" as keyof typeof settingsService.getAll,
        "value"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown setting");
    });

    it("should fail for unknown setting", () => {
      const result = settingsService.set(
        "unknownSetting" as keyof typeof settingsService.getAll,
        "value"
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown setting");
    });

    it("should fail for invalid number", () => {
      const result = settingsService.set("port", "not-a-number");
      expect(result.success).toBe(false);
      expect(result.error).toContain("integer");
    });
  });

  describe("reset", () => {
    it("should reset all settings to defaults", () => {
      settingsService = new SettingsService();

      // Change some settings
      settingsService.set("port", "9999");
      settingsService.set("editor", "nano");

      // Reset
      settingsService.reset();

      // Verify defaults
      expect(settingsService.get("port")).toBe(8850);
      expect(settingsService.get("editor")).toBeDefined();
    });
  });

  describe("getInfo", () => {
    it("should return settings metadata", () => {
      settingsService = new SettingsService();

      const info = settingsService.getInfo();
      expect(info.port).toBeDefined();
      expect(info.port.type).toBe("number");
      expect(info.editor).toBeDefined();
      expect(info.editor.type).toBe("string");
    });
  });

  describe("getKeys", () => {
    it("should return all setting keys", () => {
      settingsService = new SettingsService();

      const keys = settingsService.getKeys();
      expect(keys).toContain("port");
      expect(keys).toContain("editor");
      expect(keys).not.toContain("theme"); // theme is hidden
      expect(keys).not.toContain("defaultProfile"); // defaultProfile is hidden
    });
  });

  describe("isDefault", () => {
    it("should check if value is default", () => {
      settingsService = new SettingsService();

      expect(settingsService.isDefault("port")).toBe(true);

      settingsService.set("port", "9999");
      expect(settingsService.isDefault("port")).toBe(false);
    });
  });

  describe("getOptions", () => {
    it("should return undefined for keys without options (port)", () => {
      settingsService = new SettingsService();

      const options = settingsService.getOptions("port");
      expect(options).toBeUndefined();
    });

    it("should return undefined for keys without options (editor)", () => {
      settingsService = new SettingsService();

      const options = settingsService.getOptions("editor");
      expect(options).toBeUndefined();
    });
  });

  describe("getTheme", () => {
    it("should return default theme (internal use only)", () => {
      settingsService = new SettingsService();

      const theme = settingsService.getTheme();
      expect(theme).toBe("default");
    });
  });
});
