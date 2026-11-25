/**
 * Parse and format command arguments for local MCP servers.
 *
 * The value the user types is a flat string, so it needs a tokenizer. It is
 * deliberately not a shell: quotes group, nothing is expanded or evaluated.
 */

const WHITESPACE = [" ", "\t", "\n", "\r"];
const COMMA = ",";

function isQuote(char: string | undefined): boolean {
  return char === '"' || char === "'";
}

interface ParseOptions {
  /** Treat commas as separators too (the CLI documents this). */
  commaSeparated?: boolean;
}

/**
 * Split CLI/TUI argument text into argv.
 * Whitespace separates arguments, plus commas when `commaSeparated` is set.
 * Quotes group and are removed from the result, never expanded.
 */
export function parseArgsInput(value: string, options: ParseOptions = {}): string[] {
  const separators = options.commaSeparated ? [...WHITESPACE, COMMA] : WHITESPACE;
  const args: string[] = [];
  let current = "";
  let hasCurrent = false;

  const flush = (): void => {
    if (hasCurrent) args.push(current);
    current = "";
    hasCurrent = false;
  };

  let index = 0;
  while (index < value.length) {
    const char = value[index];

    if (separators.includes(char)) {
      flush();
      index++;
      continue;
    }

    if (isQuote(char)) {
      const end = value.indexOf(char, index + 1);
      if (end === -1) {
        current += char;
        hasCurrent = true;
        index++;
        continue;
      }
      current += value.slice(index + 1, end);
      hasCurrent = true;
      index = end + 1;
      continue;
    }

    current += char;
    hasCurrent = true;
    index++;
  }

  flush();
  return args;
}

function needsQuoting(arg: string, commaSeparated: boolean): boolean {
  if (arg === "") return true;
  for (const char of arg) {
    if (WHITESPACE.includes(char) || isQuote(char)) return true;
    if (commaSeparated && char === COMMA) return true;
  }
  return false;
}

/**
 * Join argv back into the text form `parseArgsInput` reads, quoting arguments
 * that would otherwise be split. Round-trips with `parseArgsInput`.
 */
export function formatArgsInput(args: string[], options: ParseOptions = {}): string {
  const commaSeparated = options.commaSeparated === true;
  return args
    .map((arg) => {
      if (!needsQuoting(arg, commaSeparated)) return arg;
      const quote = arg.includes("'") ? '"' : "'";
      return `${quote}${arg}${quote}`;
    })
    .join(" ");
}
