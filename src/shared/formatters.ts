/**
 * Shared formatting utilities
 */

/**
 * Format token count with K/M suffixes for readability
 * @param tokens - Number of tokens to format
 * @returns Formatted string (e.g., "1.5K", "2.3M", "500")
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
}

/**
 * Output data as formatted JSON to stdout
 * @param data - Data to serialize and output
 */
export function formatSwitchable(label: string): string {
  return `◀ ${label} ▶`;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
