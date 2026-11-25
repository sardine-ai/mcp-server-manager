import { describe, expect, it } from "vitest";
import { formatArgsInput, parseArgsInput } from "../src/shared/args.js";

describe("parseArgsInput", () => {
  it("splits on whitespace and keeps quotes out of the result", () => {
    expect(parseArgsInput("  npx   -y   server  ")).toEqual(["npx", "-y", "server"]);
    expect(parseArgsInput("")).toEqual([]);
    expect(parseArgsInput("   ")).toEqual([]);
  });

  it("keeps quoted values as a single argument", () => {
    expect(parseArgsInput('--dir "/tmp/my projects"')).toEqual(["--dir", "/tmp/my projects"]);
    expect(parseArgsInput("--dir '/tmp/my projects'")).toEqual(["--dir", "/tmp/my projects"]);
  });

  it("keeps whitespace inside quotes as part of one argument", () => {
    expect(parseArgsInput('"-y server"')).toEqual(["-y server"]);
  });

  it("does not expand globs, variables or commands", () => {
    expect(parseArgsInput('--pattern "*.ts" --home $HOME --note "$(whoami)"')).toEqual([
      "--pattern",
      "*.ts",
      "--home",
      "$HOME",
      "--note",
      "$(whoami)",
    ]);
  });

  it("treats commas as separators only when asked", () => {
    expect(parseArgsInput("-y,server,/tmp")).toEqual(["-y,server,/tmp"]);
    expect(parseArgsInput("-y,server,/tmp", { commaSeparated: true })).toEqual([
      "-y",
      "server",
      "/tmp",
    ]);
    expect(parseArgsInput('"/tmp/a,b",c', { commaSeparated: true })).toEqual(["/tmp/a,b", "c"]);
  });

  it("keeps empty quoted values", () => {
    expect(parseArgsInput('--note ""')).toEqual(["--note", ""]);
  });

  it("keeps an unmatched quote as literal text", () => {
    expect(parseArgsInput('--dir "/tmp/half')).toEqual(["--dir", '"/tmp/half']);
  });
});

describe("formatArgsInput", () => {
  it("joins plain args with spaces", () => {
    expect(formatArgsInput(["npx", "-y", "server"])).toBe("npx -y server");
  });

  it("quotes args the parser would otherwise split", () => {
    expect(formatArgsInput(["--dir", "/tmp/my projects"])).toBe('--dir "/tmp/my projects"');
    expect(formatArgsInput(["--note", ""])).toBe('--note ""');
  });

  it("round-trips through the parser", () => {
    const args = [
      "--dir",
      "/tmp/my projects",
      "--note",
      "a,b",
      "--pattern",
      "*.ts",
      'he said "hi"',
    ];
    expect(parseArgsInput(formatArgsInput(args))).toEqual(args);
  });

  it("round-trips with comma separation enabled", () => {
    const args = ["--dir", "/tmp/my projects", "--note", "a,b"];
    const input = formatArgsInput(args, { commaSeparated: true });
    expect(parseArgsInput(input, { commaSeparated: true })).toEqual(args);
  });

  it("round-trips args that contain both quote characters", () => {
    for (const arg of [`has 'single' and "double"`, `a'b "c`, `x"y 'z`]) {
      expect(parseArgsInput(formatArgsInput([arg]))).toEqual([arg]);
    }
  });

  it("round-trips backslashes without eating them", () => {
    for (const arg of ["C:\\path with space", "end with backslash\\", "\\\\"]) {
      expect(parseArgsInput(formatArgsInput([arg]))).toEqual([arg]);
    }
  });

  it("unescapes a quote inside a quoted run", () => {
    expect(parseArgsInput(`'a\\'b'`)).toEqual(["a'b"]);
    expect(parseArgsInput(`"say \\"hi\\""`)).toEqual(['say "hi"']);
  });
});
