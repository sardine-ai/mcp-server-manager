export function updateGatewayAddresses(servers: Record<string, unknown>, port: number) {
  let changed = false;
  const update = (value: string) => {
    if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+\/mcp(?:\/|$)/.test(value)) return value;
    const url = new URL(value);
    if (url.port === String(port)) return value;
    url.port = String(port);
    changed = true;
    return url.toString();
  };
  for (const [key, server] of Object.entries(servers)) {
    if (key !== "mcpsm" && !key.startsWith("mcpsm-")) continue;
    if (!server || typeof server !== "object") continue;
    if ("url" in server && typeof server.url === "string") server.url = update(server.url);
    if ("args" in server && Array.isArray(server.args)) {
      server.args = server.args.map((arg: unknown) =>
        typeof arg === "string" ? update(arg) : arg
      );
    }
  }
  return changed;
}
