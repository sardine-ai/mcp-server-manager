import React from "react";
import { describe, it, beforeEach, expect, vi } from "vitest";
import { render } from "../setup.js";
import {
  mockConfigService,
  mockAuthService,
  mockTestingService,
  waitForStateUpdate,
  sampleRemoteServers,
  KEYS,
} from "../../tui/setup.js";

import { AuthScreen } from "../../../src/tui/screens/AuthScreen.js";

describe("AuthScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigService.getRemoteServers.mockReturnValue(
      sampleRemoteServers.map((s) => ({ ...s, oauth: { enabled: true } }))
    );
    mockAuthService.isRefreshable.mockReturnValue(false);
  });

  it("runs login-all when A is pressed", async () => {
    mockAuthService.startOAuthFlow.mockResolvedValue({ authUrl: "https://auth", state: "state" });
    mockAuthService.waitForAuth.mockResolvedValue({ success: true });
    mockAuthService.hasValidToken.mockReturnValue(false);
    mockAuthService.getTokenForServer.mockReturnValue(null);
    mockTestingService.testRemoteServer?.mockReturnValue(
      Promise.resolve({ success: false, requiresAuth: true })
    );

    const { stdin } = render(<AuthScreen onBack={() => {}} />);
    await waitForStateUpdate();
    stdin.write("a");
    await waitForStateUpdate(300);

    expect(mockAuthService.startOAuthFlow).toHaveBeenCalled();
  });

  it("revokes a token when confirmed after pressing R", async () => {
    mockAuthService.hasValidToken.mockReturnValue(true);
    mockAuthService.getTokenForServer.mockReturnValue({
      accessToken: "token",
      refreshToken: "refresh",
      tokenType: "Bearer",
    });

    const { stdin, lastFrame } = render(<AuthScreen onBack={() => {}} />);
    await waitForStateUpdate();

    await waitForStateUpdate(200);
    stdin.write("r");
    await waitForStateUpdate(200);
    expect(lastFrame()).toContain("Revoke Token");

    stdin.write("Y");
    await waitForStateUpdate(500);

    expect(mockAuthService.removeToken).toHaveBeenCalledWith(sampleRemoteServers[0].id);
  });

  it("reports connection failure after OAuth completes instead of login success", async () => {
    mockConfigService.getRemoteServers.mockReturnValue([
      { ...sampleRemoteServers[0], oauth: { enabled: true } },
    ]);
    mockAuthService.getTokenForServer.mockReturnValue(null);
    mockAuthService.startOAuthFlow.mockResolvedValue({ authUrl: "https://auth", state: "state" });
    mockAuthService.waitForAuth.mockResolvedValue({ success: true });
    mockTestingService.testRemoteServer.mockResolvedValue({
      success: false,
      toolCount: 0,
      error: "HTTP 401",
    });
    const onAuthComplete = vi.fn();
    const { stdin, lastFrame } = render(
      <AuthScreen onBack={() => {}} onAuthComplete={onAuthComplete} />
    );
    await waitForStateUpdate();
    stdin.write("a");
    await waitForStateUpdate(300);

    expect(lastFrame()).toContain("connection test failed: HTTP 401");
    expect(lastFrame()).not.toContain("authenticated successfully");
    expect(onAuthComplete).toHaveBeenCalledWith(sampleRemoteServers[0].id, false);
  });

  it("goes back on ESC", async () => {
    const onBack = vi.fn();
    const { stdin } = render(<AuthScreen onBack={onBack} />);
    await vi.waitFor(() => expect(stdin.listenerCount("readable")).toBeGreaterThan(0));
    stdin.write(KEYS.ESCAPE);
    await vi.waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it("allows login when an expired token has a refresh token but refresh fails", async () => {
    mockConfigService.getRemoteServers.mockReturnValue([
      { ...sampleRemoteServers[0], oauth: { enabled: true } },
    ]);
    mockAuthService.getTokenForServer.mockReturnValue({
      accessToken: "expired",
      refreshToken: "expired-refresh",
      tokenType: "Bearer",
    });
    mockAuthService.isTokenExpired.mockReturnValue(true);
    mockAuthService.isRefreshable.mockReturnValue(true);
    mockAuthService.ensureValidToken.mockResolvedValue(false);
    mockAuthService.startOAuthFlow.mockResolvedValue(null);
    const { stdin, lastFrame } = render(<AuthScreen onBack={() => {}} />);
    await waitForStateUpdate();

    expect(lastFrame()).toContain("requires authentication");
    stdin.write(KEYS.ENTER);
    await waitForStateUpdate();
    expect(mockAuthService.startOAuthFlow).toHaveBeenCalled();
  });
});
