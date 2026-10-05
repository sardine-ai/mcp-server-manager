/**
 * Gemini CLI Strategy - Strategy for Google's Gemini CLI
 */

import path from "path";
import { JsonClientStrategy } from "./json-client.strategy.js";
import type {
  ClientMetadata,
  ClientCapabilities,
  ClientPlatformPaths,
} from "../../types/client-strategy.types.js";

export class GeminiStrategy extends JsonClientStrategy {
  readonly metadata: ClientMetadata = {
    id: "gemini",
    displayName: "Gemini CLI",
    description: "Google's Gemini command-line interface",
  };

  readonly capabilities: ClientCapabilities = {
    supportsRealTimeReload: false,
    hasSecondaryConfigPath: false,
    configFormat: "json",
    gatewayType: "stdio",
  };

  readonly paths: ClientPlatformPaths = {
    project: ".gemini/settings.json",
    primary: {
      darwin: path.join(this.getHomedir(), ".gemini/settings.json"),
      win32: path.join(this.getHomedir(), ".gemini/settings.json"),
      linux: path.join(this.getHomedir(), ".gemini/settings.json"),
    },
    binaryPaths: {
      darwin: "/usr/local/bin/gemini",
      linux: "/usr/local/bin/gemini",
    },
  };
}
