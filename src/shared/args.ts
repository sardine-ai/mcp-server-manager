/**
 * Parse and format local server command arguments.
 *
 * The value a user types is a flat string, so it needs a tokenizer. It is
 * deliberately not a shell: quotes group, nothing is expanded or evaluated.
 */

const WHITESPACE = [" ", "\t", "\n", "\r"];
const QUOTES = ['"', "'"];

interface ArgsOptions {
  /** Treat commas as separators too (documented for `mcpsm add --args`). */
  commaSeparated?: boolean;
}

function isQuote(char: string): boolean {
  return QUOTES.includes(char);
}

function isSeparator(char: string, commaSeparated: boolean): boolean {
  return WHITESPACE.includes(char) || (commaSeparated && char === ",");
}

/** Index of the quote closing the one at `start`, or -1. Backslash escapes skip. */
function closingQuote(value: string, start: number): number {
  const quote = value[start];
  for (let index = start + 1; index < value.length; index++) {
    if (value[index] === "\\") index++;
    else if (value[index] === quote) return index;
  }
  return -1;
}

/**
 * Split CLI/TUI argument text into argv.
 * Whitespace separates arguments, plus commas when `commaSeparated` is set.
 * Quotes group and are removed from the result, never expanded.
 */
export function parseArgsInput(value: string, options: ArgsOptions = {}): string[] {
  const commaSeparated = options.commaSeparated === true;
  const args: string[] = [];
  let current = "";
  let started = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];

    if (isSeparator(char, commaSeparated)) {
      if (started) args.push(current);
      current = "";
      started = false;
      continue;
    }

    if (isQuote(char)) {
      const end = closingQuote(value, index);
      if (end === -1) {
        current += char;
      } else {
        current += value.slice(index + 1, end).replace(/\\([\\"'])/g, "$1");
        index = end;
      }
      started = true;
      continue;
    }

    current += char;
    started = true;
  }

  if (started) args.push(current);
  return args;
}

function needsQuoting(arg: string, commaSeparated: boolean): boolean {
  if (arg === "") return true;
  for (const char of arg) {
    if (isSeparator(char, commaSeparated) || isQuote(char)) return true;
  }
  return false;
}

/**
 * Join argv back into the text form `parseArgsInput` reads, quoting arguments
 * that would otherwise be split. Always uses double quotes, so a parser bug
 * cannot eat an argument. Round-trips with `parseArgsInput`.
 */
export function formatArgsInput(args: string[], options: ArgsOptions = {}): string {
  const commaSeparated = options.commaSeparated === true;
  return args
    .map((arg) => {
      if (!needsQuoting(arg, commaSeparated)) return arg;
      return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    })
    .join(" ");
}
