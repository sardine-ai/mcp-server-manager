import { describe, expect, it } from "vitest";
import { REDACTED_PLACEHOLDER, redactServerForOutput } from "../src/shared/redaction.js";
import type { LocalServer, RemoteServer } from "../src/types/index.js";

describe("redactServerForOutput", () => {
  it("redacts every environment value on local servers without mutating the input", () => {
    const server: LocalServer = {
      id: "local",
      name: "Local",
      command: "node",
      args: ["server.js"],
      env: {
        API_KEY: "secret",
        NORMAL: "value",
      },
    };

    const redacted = redactServerForOutput(server) as LocalServer;

    expect(redacted).toEqual({
      ...server,
      env: {
        API_KEY: REDACTED_PLACEHOLDER,
        NORMAL: REDACTED_PLACEHOLDER,
      },
    });
    expect(server.env).toEqual({
      API_KEY: "secret",
      NORMAL: "value",
    });
  });

  it("keeps local servers without env unchanged", () => {
    const server: LocalServer = {
      id: "local",
      name: "Local",
      command: "node",
      args: [],
    };

    expect(redactServerForOutput(server)).toEqual(server);
  });

  it("redacts bearer tokens, headers, and OAuth client secrets on remote servers", () => {
    const server: RemoteServer = {
      id: "remote",
      name: "Remote",
      type: "http",
      url: "https://example.test/mcp",
      bearerToken: "bearer-secret",
      headers: {
        Authorization: "Bearer secret",
        "X-API-Key": "api-secret",
      },
      oauth: {
        enabled: true,
        clientId: "client-id",
        clientSecret: "client-secret",
        scopes: ["tools"],
      },
    };

    const redacted = redactServerForOutput(server) as RemoteServer;

    expect(redacted.bearerToken).toBe(REDACTED_PLACEHOLDER);
    expect(redacted.headers).toEqual({
      Authorization: REDACTED_PLACEHOLDER,
      "X-API-Key": REDACTED_PLACEHOLDER,
    });
    expect(redacted.oauth).toEqual({
      enabled: true,
      clientId: "client-id",
      clientSecret: REDACTED_PLACEHOLDER,
      scopes: ["tools"],
    });
    expect(server.bearerToken).toBe("bearer-secret");
    expect(server.headers?.Authorization).toBe("Bearer secret");
    expect(server.oauth?.clientSecret).toBe("client-secret");
  });

  it("preserves non-secret remote server fields", () => {
    const server: RemoteServer = {
      id: "remote",
      name: "Remote",
      type: "sse",
      url: "https://example.test/sse",
      oauth: {
        enabled: false,
        clientId: "public-client",
      },
    };

    expect(redactServerForOutput(server)).toEqual(server);
  });
});
