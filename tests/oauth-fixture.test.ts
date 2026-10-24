import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../src/services/auth.service.js";

describe("OAuth login and refresh against a local fixture", () => {
  let directory: string;
  let auth: AuthService;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcpsm-oauth-fixture-"));
    auth = new AuthService(directory);
  });
  afterEach(() => {
    auth.stopCallbackServer();
    auth.stopProactiveRefresh();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("preserves PKCE, client credentials, scope and rotating refresh tokens", async () => {
    let origin = "";
    const tokenRequests: URLSearchParams[] = [];
    const server = createServer(async (request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url?.startsWith("/.well-known/oauth-protected-resource")) {
        response.end(
          JSON.stringify({ resource: origin + "/mcp", authorization_servers: [origin] })
        );
        return;
      }
      if (request.url?.startsWith("/.well-known/oauth-authorization-server")) {
        response.end(
          JSON.stringify({
            issuer: origin,
            authorization_endpoint: origin + "/authorize",
            token_endpoint: origin + "/token",
          })
        );
        return;
      }
      if (request.url === "/token") {
        let body = "";
        for await (const chunk of request) body += chunk;
        const params = new URLSearchParams(body);
        tokenRequests.push(params);
        const refresh = params.get("grant_type") === "refresh_token";
        response.end(
          JSON.stringify({
            access_token: refresh ? "access-two" : "access-one",
            refresh_token: refresh ? "refresh-two" : "refresh-one",
            token_type: "Bearer",
            expires_in: 60,
            ...(refresh ? {} : { scope: "read" }),
          })
        );
        return;
      }
      response.writeHead(404).end("{}");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    origin = "http://127.0.0.1:" + address.port;
    const remote = {
      id: "fixture",
      name: "Fixture",
      type: "http" as const,
      url: origin + "/mcp",
      oauth: {
        enabled: true,
        clientId: "fixture-client",
        clientSecret: "fixture-secret",
        scopes: ["read"],
      },
    };
    try {
      const flow = await auth.startOAuthFlow(remote);
      expect(flow).not.toBeNull();
      if (!flow) throw new Error("No authorization flow");
      const authorization = new URL(flow.authUrl);
      expect(authorization.searchParams.get("resource")).toBe(remote.url);
      expect(authorization.searchParams.get("scope")).toBe("read");
      const waiting = auth.waitForAuth(flow.state);
      const callback = authorization.searchParams.get("redirect_uri");
      const response = await fetch(callback + "?code=fixture-code&state=" + flow.state);
      expect(response.status).toBe(200);
      await response.text();
      await expect(waiting).resolves.toMatchObject({ success: true, token: "access-one" });
      const verifier = tokenRequests[0].get("code_verifier") || "";
      expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
        authorization.searchParams.get("code_challenge")
      );
      expect(tokenRequests[0].get("client_secret")).toBe("fixture-secret");
      const stored = auth.getToken(remote.id);
      if (!stored) throw new Error("Missing saved credentials");
      const refreshed = await auth.refreshTokenWithMutex(remote, stored);
      expect(refreshed).toMatchObject({
        accessToken: "access-two",
        refreshToken: "refresh-two",
        scopes: ["read"],
      });
      expect(tokenRequests[1].get("refresh_token")).toBe("refresh-one");
      expect(tokenRequests[1].get("client_id")).toBe("fixture-client");
      auth.releaseOAuthFlow(flow.state);
      expect(new AuthService(directory).getToken(remote.id)?.refreshToken).toBe("refresh-two");
    } finally {
      auth.stopCallbackServer();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
