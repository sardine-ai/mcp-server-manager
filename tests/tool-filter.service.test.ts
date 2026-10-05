import { describe, expect, it } from "vitest";
import { ToolFilterService } from "../src/services/config/tool-filter.service.js";
import type { ConfigRepository } from "../src/services/config/config.repository.js";
import type { ServerToolFilter, ToolFilters } from "../src/types/index.js";

class FakeToolFilterRepository {
  constructor(private filters: ToolFilters = {}) {}

  getToolFilters(): ToolFilters {
    return this.filters;
  }

  updateToolFilters(update: (filters: ToolFilters) => void): void {
    update(this.filters);
  }
}

function createService(initialFilters: ToolFilters = {}): {
  service: ToolFilterService;
  repository: FakeToolFilterRepository;
} {
  const repository = new FakeToolFilterRepository(initialFilters);
  return {
    service: new ToolFilterService(repository as unknown as ConfigRepository),
    repository,
  };
}

describe("ToolFilterService", () => {
  it("returns all filters and a specific server filter", () => {
    const filter: ServerToolFilter = {
      allTools: ["search", "fetch"],
      disabledTools: ["fetch"],
    };
    const { service } = createService({ server: filter });

    expect(service.getToolFilters()).toEqual({ server: filter });
    expect(service.getServerToolFilter("server")).toBe(filter);
    expect(service.getServerToolFilter("missing")).toBeUndefined();
  });

  it("sets and removes server filters", () => {
    const { service, repository } = createService();

    service.setServerToolFilter("server", { allTools: ["search"], disabledTools: [] });
    expect(repository.getToolFilters()).toEqual({
      server: { allTools: ["search"], disabledTools: [] },
    });

    service.removeFilter("server");
    expect(repository.getToolFilters()).toEqual({});
  });

  it("toggles a tool between enabled and disabled states", () => {
    const { service } = createService({
      server: { allTools: ["search", "fetch"], disabledTools: ["fetch"] },
    });

    service.toggleTool("server", "search");
    expect(service.getDisabledTools("server")).toEqual(["fetch", "search"]);
    expect(service.isToolEnabled("server", "search")).toBe(false);

    service.toggleTool("server", "fetch");
    expect(service.getDisabledTools("server")).toEqual(["search"]);
    expect(service.isToolEnabled("server", "fetch")).toBe(true);
  });

  it("ignores enable, disable, and toggle requests for missing filters", () => {
    const { service, repository } = createService();

    service.toggleTool("missing", "search");
    service.enableTool("missing", "search");
    service.disableTool("missing", "search");
    service.enableAllTools("missing");
    service.disableAllTools("missing");

    expect(repository.getToolFilters()).toEqual({});
    expect(service.isToolEnabled("missing", "search")).toBe(true);
    expect(service.getEnabledTools("missing")).toEqual([]);
    expect(service.getDisabledTools("missing")).toEqual([]);
  });

  it("enables and disables individual tools without duplicating disabled entries", () => {
    const { service } = createService({
      server: { allTools: ["search", "fetch"], disabledTools: ["fetch"] },
    });

    service.disableTool("server", "search");
    service.disableTool("server", "search");
    expect(service.getDisabledTools("server").sort()).toEqual(["fetch", "search"]);

    service.enableTool("server", "fetch");
    expect(service.getDisabledTools("server")).toEqual(["search"]);
    expect(service.getEnabledTools("server")).toEqual(["fetch"]);
  });

  it("enables or disables every known tool for a server", () => {
    const { service } = createService({
      server: { allTools: ["search", "fetch", "list"], disabledTools: ["fetch"] },
    });

    service.disableAllTools("server");
    expect(service.getDisabledTools("server")).toEqual(["search", "fetch", "list"]);
    expect(service.getEnabledTools("server")).toEqual([]);

    service.enableAllTools("server");
    expect(service.getDisabledTools("server")).toEqual([]);
    expect(service.getEnabledTools("server")).toEqual(["search", "fetch", "list"]);
  });

  it("resets filters when present and reports an error when absent", () => {
    const { service } = createService({
      server: { allTools: ["search"], disabledTools: ["search"] },
    });

    expect(service.resetToolFilters("missing")).toEqual({
      success: false,
      error: "No tool filter found for 'missing'",
    });

    expect(service.resetToolFilters("server")).toEqual({ success: true });
    expect(service.getDisabledTools("server")).toEqual([]);
  });
});
