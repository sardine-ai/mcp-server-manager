import { parse, type ParseError } from "jsonc-parser";

export function parseJsonWithComments(input: string) {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(input, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}
