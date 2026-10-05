import { afterEach, describe, expect, it, vi } from "vitest";
import {
  c,
  clearLine,
  clearScreen,
  colors,
  hideCursor,
  moveCursor,
  moveDown,
  moveUp,
  showCursor,
} from "../src/shared/colors.js";

describe("Colors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should export color codes", () => {
    expect(colors).toBeDefined();
    expect(colors.reset).toBeDefined();
    expect(colors.bright).toBeDefined();
    expect(colors.red).toBeDefined();
    expect(colors.green).toBeDefined();
    expect(colors.yellow).toBeDefined();
    expect(colors.blue).toBeDefined();
    expect(colors.cyan).toBeDefined();
    expect(colors.gray).toBeDefined();
  });

  it("should have ANSI escape codes", () => {
    expect(colors.reset).toContain("\x1b[");
    expect(colors.red).toContain("\x1b[");
    expect(colors.green).toContain("\x1b[");
  });

  it("should export clearScreen function", () => {
    expect(clearScreen).toBeDefined();
    expect(typeof clearScreen).toBe("function");
  });

  it("wraps text with helper colors and exports colored icons", () => {
    expect(c.reset("text")).toBe(`${colors.reset}text${colors.reset}`);
    expect(c.bright("text")).toBe(`${colors.bright}text${colors.reset}`);
    expect(c.dim("text")).toBe(`${colors.dim}text${colors.reset}`);
    expect(c.red("text")).toBe(`${colors.red}text${colors.reset}`);
    expect(c.green("text")).toBe(`${colors.green}text${colors.reset}`);
    expect(c.yellow("text")).toBe(`${colors.yellow}text${colors.reset}`);
    expect(c.blue("text")).toBe(`${colors.blue}text${colors.reset}`);
    expect(c.magenta("text")).toBe(`${colors.magenta}text${colors.reset}`);
    expect(c.cyan("text")).toBe(`${colors.cyan}text${colors.reset}`);
    expect(c.white("text")).toBe(`${colors.white}text${colors.reset}`);
    expect(c.gray("text")).toBe(`${colors.gray}text${colors.reset}`);
    expect(c.success("ok")).toBe(`${colors.green}${colors.bright}ok${colors.reset}`);
    expect(c.error("bad")).toBe(`${colors.red}${colors.bright}bad${colors.reset}`);
    expect(c.warning("warn")).toBe(`${colors.yellow}${colors.bright}warn${colors.reset}`);
    expect(c.info("info")).toBe(`${colors.cyan}${colors.bright}info${colors.reset}`);
    expect(c.checkmark).toContain("✓");
    expect(c.cross).toContain("✗");
    expect(c.warning_icon).toContain("⚠");
    expect(c.info_icon).toContain("ℹ");
    expect(c.arrow).toContain("→");
    expect(c.bullet).toContain("•");
  });

  it("writes terminal control sequences", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const clear = vi.spyOn(console, "clear").mockImplementation(() => undefined);

    clearScreen();
    moveCursor(3, 4);
    hideCursor();
    showCursor();
    clearLine();
    moveUp();
    moveUp(2);
    moveDown();
    moveDown(3);

    expect(clear).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith("\x1b[3;4H");
    expect(write).toHaveBeenCalledWith("\x1b[?25l");
    expect(write).toHaveBeenCalledWith("\x1b[?25h");
    expect(write).toHaveBeenCalledWith("\x1b[2K");
    expect(write).toHaveBeenCalledWith("\x1b[1A");
    expect(write).toHaveBeenCalledWith("\x1b[2A");
    expect(write).toHaveBeenCalledWith("\x1b[1B");
    expect(write).toHaveBeenCalledWith("\x1b[3B");
  });
});
