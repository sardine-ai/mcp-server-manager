import type {
  LocalServer,
  RemoteServer,
  ServerToolFilter,
  ToolFilters,
} from "../../types/index.js";

export function filterIndicatesAuth(filter?: ServerToolFilter) {
  const message = filter?.error?.toLowerCase() || "";
  return message.includes("auth") || message.includes("unauthorized") || message.includes("401");
}

export function deriveServerViews(
  local: LocalServer[],
  remote: RemoteServer[],
  filters: ToolFilters,
  validTokens: Set<string>,
  refreshedTokens = new Set<string>()
) {
  const toolCounts = new Map<string, number>();
  const serversNeedingAuth = new Set<string>();
  for (const server of local) {
    const filter = filters[server.id];
    if (filter?.allTools) toolCounts.set(server.id, filter.allTools.length);
  }
  for (const server of remote) {
    const key = "remote:" + server.id;
    const filter = filters[key];
    if (filter?.allTools) toolCounts.set(key, filter.allTools.length);
    if (
      !refreshedTokens.has(server.id) &&
      ((server.oauth?.enabled && !validTokens.has(server.id)) || filterIndicatesAuth(filter))
    ) {
      serversNeedingAuth.add(server.id);
    }
  }
  return { toolCounts, serversNeedingAuth };
}
