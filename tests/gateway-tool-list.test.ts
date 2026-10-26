import { describe, expect, it, vi } from "vitest";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { listToolsForGateway } from "../src/services/gateway.service.js";

describe("listToolsForGateway", () => {
  it("does not use Client.listTools output-schema validator caching", async () => {
    const tools = [
      {
        name: "get_screen",
        description: "Get a screen from a remote MCP server",
        inputSchema: { type: "object" },
        outputSchema: {
          type: "object",
          properties: {
            screen: { $ref: "#/$defs/ScreenInstance" },
          },
        },
      },
    ];
    const request = vi.fn().mockResolvedValue({ tools });
    const listTools = vi.fn().mockRejectedValue(new Error("AJV MissingRefError"));
    const client = { request, listTools } as unknown as Client;

    await expect(listToolsForGateway(client)).resolves.toEqual(tools);
    expect(request).toHaveBeenCalledWith(
      { method: "tools/list", params: {} },
      ListToolsResultSchema
    );
    expect(listTools).not.toHaveBeenCalled();
  });
});
