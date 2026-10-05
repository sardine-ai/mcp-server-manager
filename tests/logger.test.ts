import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger, createLogger, configureLogger } from "../src/shared/logger.js";

describe("Logger", () => {
  beforeEach(() => {
    configureLogger({ level: "debug" }); // Enable all logs for testing
  });

  afterEach(() => {
    vi.restoreAllMocks();
    configureLogger({ level: "info" }); // Reset to default
  });

  describe("configureLogger", () => {
    it("should set log level", () => {
      configureLogger({ level: "warn" });
      // Logger is configured, can't easily verify internal state
      // but we can verify it doesn't throw
      expect(() => configureLogger({ level: "error" })).not.toThrow();
    });
  });

  describe("createLogger", () => {
    it("should create a child logger with prefix", () => {
      const childLogger = createLogger("TestModule");

      expect(childLogger).toHaveProperty("debug");
      expect(childLogger).toHaveProperty("info");
      expect(childLogger).toHaveProperty("warn");
      expect(childLogger).toHaveProperty("error");
      expect(childLogger).toHaveProperty("success");
    });
  });

  describe("logger object", () => {
    it("should have debug, info, warn, error functions", () => {
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });

    it("should have utility functions", () => {
      expect(typeof logger.success).toBe("function");
      expect(typeof logger.fail).toBe("function");
      expect(typeof logger.warning).toBe("function");
      expect(typeof logger.blank).toBe("function");
      expect(typeof logger.section).toBe("function");
      expect(typeof logger.item).toBe("function");
      expect(typeof logger.kv).toBe("function");
      expect(typeof logger.raw).toBe("function");
    });

    it("logs messages at or above the configured level", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

      configureLogger({ level: "warn", prefix: "Root", timestamps: true });
      logger.debug("debug");
      logger.info("info");
      logger.warn("warn");
      logger.error("error");

      expect(log).not.toHaveBeenCalled();
      expect(warn.mock.calls[0][0]).toContain("[Root]");
      expect(warn.mock.calls[0][0]).toContain("[WARN]");
      expect(error.mock.calls[0][0]).toContain("[ERROR]");
    });

    it("writes raw, status, section, item, and key-value output", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

      logger.raw("raw", 1);
      logger.success("saved");
      logger.fail("failed");
      logger.warning("careful");
      logger.blank();
      logger.section("Section");
      logger.item("item", 2);
      logger.kv("Key", "Value", 1);

      expect(log).toHaveBeenCalledWith("raw", 1);
      expect(log.mock.calls.some((call) => String(call[0]).includes("saved"))).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("failed"))).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("careful"))).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("Section"))).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("    "))).toBe(true);
      expect(log.mock.calls.some((call) => String(call[0]).includes("Key"))).toBe(true);
    });

    it("creates prefixed child loggers that honor levels and timestamps", () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const childLogger = createLogger("Child");

      configureLogger({ level: "debug", timestamps: true });
      childLogger.debug("debug");
      childLogger.info("info");
      childLogger.warn("warn");
      childLogger.error("error");

      expect(log.mock.calls[0][0]).toContain("[Child]");
      expect(log.mock.calls[0][0]).toContain("[DEBUG]");
      expect(log.mock.calls[1][0]).toContain("[INFO]");
      expect(warn.mock.calls[0][0]).toContain("[WARN]");
      expect(error.mock.calls[0][0]).toContain("[ERROR]");

      configureLogger({ level: "silent" });
      childLogger.error("hidden");
      expect(error).toHaveBeenCalledTimes(1);
    });
  });
});
