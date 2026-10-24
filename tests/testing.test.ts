import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { TestingService, resetTestingService } from "../src/services/testing.service.js";
import { ConfigService, resetConfigService } from "../src/services/config.service.js";

function mockMcpFetch(names: string[]): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (init?.method !== "POST") return new globalThis.Response(null, { status: 405 });
    const request = JSON.parse(String(init.body));
    if (!("id" in request)) return new globalThis.Response(null, { status: 202 });
    const result =
      request.method === "initialize"
        ? {
            protocolVersion: "2025-11-25",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1" },
          }
        : { tools: names.map((name) => ({ name, inputSchema: { type: "object" } })) };
    return new globalThis.Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "Content-Type": "application/json" },
    });
  });
}

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
      const mockFetch = mockMcpFetch(["ask_question"]);

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
        for (const [, init] of mockFetch.mock.calls) {
          const headers = new globalThis.Headers(init?.headers);
          expect(headers.get("Authorization")).toBe("Bearer devin-token");
          expect(headers.get("X-Org-Id")).toBe("org_JVU8h2dxO575yI66");
        }
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
      const mockFetch = mockMcpFetch(["tool1", "tool2", "tool3"]);

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
      const mockFetch = mockMcpFetch(["tool1", "tool2"]);

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
