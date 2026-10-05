import { describe, expect, it } from "vitest";
import {
  createServerFormFields,
  getScopes,
  parseArgs,
  prepareLocalServer,
  prepareLocalServerUpdates,
  prepareRemoteServer,
  prepareRemoteServerUpdates,
  resolveBearerToken,
  Step,
  STEP_LABELS,
  LOCAL_STEPS,
  REMOTE_STEPS,
  REMOTE_OAUTH_STEPS,
} from "../src/tui/screens/server-form.js";
import { REDACTED_PLACEHOLDER } from "../src/shared/redaction.js";

describe("server-form helpers", () => {
  it("creates form fields and exposes step metadata", () => {
    expect(createServerFormFields({ name: "Docs", serverType: "http" })).toMatchObject({
      name: "Docs",
      serverType: "http",
      oauthEnabled: false,
    });
    expect(STEP_LABELS[Step.Name]).toBe("Server Name");
    expect(LOCAL_STEPS).toEqual([Step.Name, Step.Type, Step.Command, Step.Args, Step.Env]);
    expect(REMOTE_STEPS).toEqual([Step.Name, Step.Type, Step.Url, Step.Token, Step.OauthToggle]);
    expect(REMOTE_OAUTH_STEPS).toContain(Step.AuthServer);
  });

  it("parses command args, scopes, and bearer tokens", () => {
    expect(parseArgs("  npx   -y   server  ")).toEqual(["npx", "-y", "server"]);
    expect(parseArgs("   ")).toEqual([]);
    expect(getScopes("read, write profile")).toEqual(["read", "write", "profile"]);
    expect(resolveBearerToken(" token ")).toBe("token");
    expect(resolveBearerToken("")).toBeUndefined();
    expect(resolveBearerToken(REDACTED_PLACEHOLDER)).toBeUndefined();
  });

  it("validates and prepares local servers", () => {
    expect(prepareLocalServer(createServerFormFields(), "local")).toEqual({
      success: false,
      error: "Name is required",
    });
    expect(prepareLocalServer(createServerFormFields({ name: "Local" }), "local")).toEqual({
      success: false,
      error: "Command is required",
    });
    expect(
      prepareLocalServer(
        createServerFormFields({ name: "Local", command: "node", env: "BAD" }),
        "local"
      )
    ).toMatchObject({
      success: false,
    });

    expect(
      prepareLocalServer(
        createServerFormFields({
          name: " Local ",
          command: " node ",
          args: "server.js --stdio",
          env: "API_KEY=secret, DEBUG=true",
        }),
        "local"
      )
    ).toEqual({
      success: true,
      data: {
        id: "local",
        name: "Local",
        command: "node",
        args: ["server.js", "--stdio"],
        env: { API_KEY: "secret", DEBUG: "true" },
      },
    });
  });

  it("prepares local server updates and clears empty env", () => {
    expect(
      prepareLocalServerUpdates(
        createServerFormFields({
          name: "Local",
          command: "node",
          args: "",
          env: "",
        })
      )
    ).toEqual({
      success: true,
      data: {
        name: "Local",
        command: "node",
        args: [],
        env: undefined,
      },
    });
  });

  it("validates and prepares remote servers", () => {
    expect(prepareRemoteServer(createServerFormFields(), "remote")).toMatchObject({
      success: false,
      error: "Name is required",
    });
    expect(prepareRemoteServer(createServerFormFields({ name: "Remote" }), "remote")).toMatchObject(
      {
        success: false,
        error: "URL is required",
      }
    );
    expect(
      prepareRemoteServer(
        createServerFormFields({ name: "Remote", url: "https://api.test", serverType: "stdio" }),
        "remote"
      )
    ).toMatchObject({
      success: false,
      error: "Transport type is required",
    });

    expect(
      prepareRemoteServer(
        createServerFormFields({
          name: "Remote",
          url: " https://api.test/mcp ",
          serverType: "http",
          token: " bearer ",
          oauthEnabled: true,
          clientId: " client ",
          clientSecret: " secret ",
          scopes: "read,write",
          authServerUrl: " https://auth.test ",
        }),
        "remote"
      )
    ).toEqual({
      success: true,
      data: {
        id: "remote",
        name: "Remote",
        url: "https://api.test/mcp",
        type: "http",
        bearerToken: "bearer",
        oauth: {
          enabled: true,
          clientId: "client",
          clientSecret: "secret",
          scopes: ["read", "write"],
          authServerUrl: "https://auth.test",
        },
      },
    });
  });

  it("prepares remote updates while preserving redacted tokens and explicit OAuth disabled state", () => {
    expect(
      prepareRemoteServerUpdates(
        createServerFormFields({
          name: "Remote",
          url: "https://api.test/mcp",
          serverType: "sse",
          token: REDACTED_PLACEHOLDER,
        })
      )
    ).toEqual({
      success: true,
      data: {
        name: "Remote",
        url: "https://api.test/mcp",
        type: "sse",
        oauth: { enabled: false },
      },
    });

    expect(
      prepareRemoteServerUpdates(
        createServerFormFields({
          name: "Remote",
          url: "https://api.test/mcp",
          serverType: "http",
          token: "",
        })
      )
    ).toEqual({
      success: true,
      data: {
        name: "Remote",
        url: "https://api.test/mcp",
        type: "http",
        bearerToken: undefined,
        oauth: { enabled: false },
      },
    });
  });
});
