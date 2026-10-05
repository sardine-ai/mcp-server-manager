import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TestingService, resetTestingService } from "../src/services/testing.service.js";
import { ConfigService, resetConfigService } from "../src/services/config.service.js";

// Test directory setup
const testConfigDir = path.join(os.tmpdir(), "mcpsm-testing-test-" + Date.now());

describe("TestingService", () => {
  let testingService: TestingService;

  beforeEach(() => {
    process.env.MCP_MANAGER_CONFIG_DIR = testConfigDir;
    resetConfigService();
    resetTestingService();

    if (!fs.existsSync(testConfigDir)) {
      fs.mkdirSync(testConfigDir, { recursive: true });
    }

    // Write default config with servers
    fs.writeFileSync(
      path.join(testConfigDir, "config.json"),
      JSON.stringify({
        servers: [
          { id: "local-1", name: "Local 1", command: "node", args: ["server.js"] },
          { id: "local-2", name: "Local 2", command: "npx", args: ["-y", "test"] },
          { id: "local-3", name: "Local 3", command: "python", args: ["-m", "mcp"] },
        ],
        remoteServers: [
          { id: "remote-1", name: "Remote 1", type: "http", url: "http://localhost:3000" },
          { id: "remote-2", name: "Remote 2", type: "sse", url: "http://localhost:4000/sse" },
        ],
        port: 8850,
      })
    );

    // Write tool filters - some servers have tools, some don't
    fs.writeFileSync(
      path.join(testConfigDir, "tool-filters.json"),
      JSON.stringify({
        "local-1": {
          allTools: ["tool1", "tool2"],
          disabledTools: [],
          totalTokens: 500,
        },
        "remote:remote-1": {
          allTools: ["remoteTool"],
          disabledTools: [],
          totalTokens: 200,
        },
      })
    );

    new ConfigService(testConfigDir);
    testingService = new TestingService();
  });

  afterEach(() => {
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
    resetTestingService();
    resetConfigService();
  });

  describe("getServersWithoutTools", () => {
    it("should return servers without tool filters", () => {
      const { local, remote } = testingService.getServersWithoutTools();

      expect(local).toHaveLength(2);
      expect(local.map((s) => s.id)).toContain("local-2");
      expect(local.map((s) => s.id)).toContain("local-3");
      expect(local.map((s) => s.id)).not.toContain("local-1");

      expect(remote).toHaveLength(1);
      expect(remote[0].id).toBe("remote-2");
    });

    it("should return all servers when no tool filters exist", () => {
      fs.writeFileSync(path.join(testConfigDir, "tool-filters.json"), JSON.stringify({}));
      resetConfigService();
      new ConfigService(testConfigDir);
      testingService = new TestingService();

      const { local, remote } = testingService.getServersWithoutTools();
      expect(local).toHaveLength(3);
      expect(remote).toHaveLength(2);
    });
  });

  describe("testLocalServer", () => {
    it("should return error when command fails to spawn", async () => {
      const server = {
        id: "bad-server",
        name: "Bad Server",
        command: "nonexistent-command-xyz",
        args: [],
      };

      const result = await testingService.testLocalServer(server);
      expect(result.success).toBe(false);
      expect(result.toolCount).toBe(0);
    });

    it("should save error to tool filters on failure", async () => {
      const server = {
        id: "error-server",
        name: "Error Server",
        command: "nonexistent-cmd-12345",
        args: [],
      };

      await testingService.testLocalServer(server);

      resetConfigService();
      const newConfigService = new ConfigService(testConfigDir);
      const toolFilters = newConfigService.getToolFilters();
      expect(toolFilters["error-server"]).toBeDefined();
    });
  });

  describe("testRemoteServer", () => {
    it("should return error when fetch fails", async () => {
      const server = {
        id: "unreachable",
        name: "Unreachable Server",
        type: "http" as const,
        url: "http://localhost:59999", // Unlikely to have anything running here
      };

      const result = await testingService.testRemoteServer(server);
      expect(result.success).toBe(false);
      expect(result.toolCount).toBe(0);
    });

    it("should save error to tool filters on failure", async () => {
      const server = {
        id: "failed-remote",
        name: "Failed Remote",
        type: "http" as const,
        url: "http://localhost:59998",
      };

      await testingService.testRemoteServer(server);

      resetConfigService();
      const newConfigService = new ConfigService(testConfigDir);
      const toolFilters = newConfigService.getToolFilters();
      expect(toolFilters["remote:failed-remote"]).toBeDefined();
    });

    it("should send custom headers with remote HTTP server requests", async () => {
      const mockFetch = vi.fn();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new globalThis.Headers(),
          json: async () => ({ result: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new globalThis.Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              tools: [{ name: "ask_question", description: "Ask Devin a question" }],
            },
          }),
        });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const server = {
          id: "devin",
          name: "devin",
          type: "http" as const,
          url: "https://mcp.devin.ai/mcp",
          headers: {
            Authorization: "Bearer devin-token",
            "X-Org-Id": "org_JVU8h2dxO575yI66",
          },
        };

        const result = await testingService.testRemoteServer(server);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch.mock.calls[0][1].headers).toMatchObject({
          Authorization: "Bearer devin-token",
          "X-Org-Id": "org_JVU8h2dxO575yI66",
        });
        expect(mockFetch.mock.calls[1][1].headers).toMatchObject({
          Authorization: "Bearer devin-token",
          "X-Org-Id": "org_JVU8h2dxO575yI66",
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("autoTestUnknownServers", () => {
    it("should not run when all servers have tools", async () => {
      // Update config so all servers have tools
      fs.writeFileSync(
        path.join(testConfigDir, "tool-filters.json"),
        JSON.stringify({
          "local-1": { allTools: ["tool"], disabledTools: [] },
          "local-2": { allTools: ["tool"], disabledTools: [] },
          "local-3": { allTools: ["tool"], disabledTools: [] },
          "remote:remote-1": { allTools: ["tool"], disabledTools: [] },
          "remote:remote-2": { allTools: ["tool"], disabledTools: [] },
        })
      );
      resetConfigService();
      new ConfigService(testConfigDir);
      testingService = new TestingService();

      // Should complete quickly without testing
      await testingService.autoTestUnknownServers();
      // No assertions needed - just verifies it doesn't throw
    });
  });

  describe("preserveDisabledTools", () => {
    it("should preserve disabledTools when updating tool filter on successful test", async () => {
      // Set up tool filter with disabled tools
      fs.writeFileSync(
        path.join(testConfigDir, "tool-filters.json"),
        JSON.stringify({
          "remote:test-server": {
            allTools: ["tool1", "tool2", "tool3"],
            disabledTools: ["tool1", "tool3"],
            enabled: ["tool2"],
            totalTokens: 300,
          },
        })
      );
      resetConfigService();
      new ConfigService(testConfigDir);
      testingService = new TestingService();

      // Mock fetch to return a successful response with tools
      const mockFetch = vi.fn();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new globalThis.Headers(),
          json: async () => ({ result: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new globalThis.Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              tools: [
                { name: "tool1", description: "Tool 1" },
                { name: "tool2", description: "Tool 2" },
                { name: "tool3", description: "Tool 3" },
              ],
            },
          }),
        });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const server = {
          id: "test-server",
          name: "Test Server",
          type: "http" as const,
          url: "http://localhost:3000",
        };

        const result = await testingService.testRemoteServer(server);

        expect(result.success).toBe(true);
        expect(result.toolCount).toBe(3);

        // Verify disabledTools was preserved
        resetConfigService();
        const newConfigService = new ConfigService(testConfigDir);
        const toolFilters = newConfigService.getToolFilters();
        const filter = toolFilters["remote:test-server"];

        expect(filter).toBeDefined();
        expect(filter.disabledTools).toEqual(["tool1", "tool3"]);
        expect(filter.allTools).toEqual(["tool1", "tool2", "tool3"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should remove disabledTools that no longer exist on server", async () => {
      // Set up tool filter with disabled tools, some of which won't exist after update
      fs.writeFileSync(
        path.join(testConfigDir, "tool-filters.json"),
        JSON.stringify({
          "remote:test-server-2": {
            allTools: ["old-tool", "tool1", "tool2"],
            disabledTools: ["old-tool", "tool1"],
            enabled: ["tool2"],
            totalTokens: 300,
          },
        })
      );
      resetConfigService();
      new ConfigService(testConfigDir);
      testingService = new TestingService();

      // Mock fetch - server now only has tool1 and tool2 (old-tool was removed)
      const mockFetch = vi.fn();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new globalThis.Headers(),
          json: async () => ({ result: {} }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new globalThis.Headers({ "content-type": "application/json" }),
          json: async () => ({
            result: {
              tools: [
                { name: "tool1", description: "Tool 1" },
                { name: "tool2", description: "Tool 2" },
              ],
            },
          }),
        });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const server = {
          id: "test-server-2",
          name: "Test Server 2",
          type: "http" as const,
          url: "http://localhost:3001",
        };

        const result = await testingService.testRemoteServer(server);

        expect(result.success).toBe(true);
        expect(result.toolCount).toBe(2);

        // Verify disabledTools was preserved but old-tool was removed
        resetConfigService();
        const newConfigService = new ConfigService(testConfigDir);
        const toolFilters = newConfigService.getToolFilters();
        const filter = toolFilters["remote:test-server-2"];

        expect(filter).toBeDefined();
        expect(filter.disabledTools).toEqual(["tool1"]); // old-tool should be removed
        expect(filter.allTools).toEqual(["tool1", "tool2"]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should preserve disabledTools when test fails with error", async () => {
      // Set up tool filter with disabled tools
      fs.writeFileSync(
        path.join(testConfigDir, "tool-filters.json"),
        JSON.stringify({
          "remote:failing-server": {
            allTools: ["tool1", "tool2"],
            disabledTools: ["tool2"],
            enabled: ["tool1"],
            totalTokens: 200,
          },
        })
      );
      resetConfigService();
      new ConfigService(testConfigDir);
      testingService = new TestingService();

      const server = {
        id: "failing-server",
        name: "Failing Server",
        type: "http" as const,
        url: "http://localhost:59997", // Port with nothing running
      };

      const result = await testingService.testRemoteServer(server);

      expect(result.success).toBe(false);

      // Verify disabledTools was preserved even after error
      resetConfigService();
      const newConfigService = new ConfigService(testConfigDir);
      const toolFilters = newConfigService.getToolFilters();
      const filter = toolFilters["remote:failing-server"];

      expect(filter).toBeDefined();
      expect(filter.disabledTools).toEqual(["tool2"]);
    });
  });
});
