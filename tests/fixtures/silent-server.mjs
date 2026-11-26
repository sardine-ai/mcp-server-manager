// A local MCP server that starts and then never answers the handshake. Records its pid in
// $PID_FILE so a test can tell whether closing the gateway also stopped this process.
import fs from "node:fs";
import process from "node:process";

fs.writeFileSync(process.env.PID_FILE, String(process.pid));

// Stay alive without speaking MCP: the gateway is left waiting to connect
setInterval(() => {}, 1000);
