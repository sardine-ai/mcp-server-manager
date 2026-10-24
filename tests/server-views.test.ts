import { describe, expect, it } from "vitest";
import { deriveServerViews } from "../src/tui/utils/serverViews.js";

describe("derived server views", () => {
  it("keeps discovered counts separate from enabled counts and clears stale auth after refresh", () => {
    const local = [{ id: "local", name: "Local", command: "node", args: [] }];
    const remote = [
      {
        id: "remote",
        name: "Remote",
        type: "http" as const,
        url: "http://fixture/mcp",
        oauth: { enabled: true },
      },
    ];
    const filters = {
      local: { allTools: ["one", "two"], enabled: ["one"], disabledTools: ["two"] },
      "remote:remote": { allTools: [], enabled: [], error: "HTTP 401" },
    };
    const cached = deriveServerViews(local, remote, filters, new Set());
    expect(cached.toolCounts.get("local")).toBe(2);
    expect(cached.toolCounts.get("remote:remote")).toBe(0);
    expect(cached.serversNeedingAuth.has("remote")).toBe(true);
    const refreshed = deriveServerViews(
      local,
      remote,
      filters,
      new Set(["remote"]),
      new Set(["remote"])
    );
    expect(refreshed.serversNeedingAuth.size).toBe(0);
    expect(filters["remote:remote"].error).toBe("HTTP 401");
  });
});
