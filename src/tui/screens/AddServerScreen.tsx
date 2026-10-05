/**
 * AddServerScreen - Interactive server addition (ink component)
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import open from "open";
import { ScreenLayout } from "../components/index.js";
import { getConfigService } from "../../services/config.service.js";
import { getTestingService } from "../../services/testing.service.js";
import { getAuthService } from "../../services/auth.service.js";
import { getDaemonService } from "../../services/daemon.service.js";
import { useTheme } from "../theme/index.js";
import {
  createServerFormFields,
  prepareLocalServer,
  prepareRemoteServer,
  ServerFormFields,
  Step,
  STEP_LABELS,
  LOCAL_STEPS,
  REMOTE_STEPS,
  REMOTE_OAUTH_STEPS,
} from "./server-form.js";

interface AddServerScreenProps {
  onBack: () => void;
}

const SERVER_TYPE_OPTIONS = [
  { label: "Local (STDIO) - Run MCP servers locally", value: "stdio" },
  { label: "Remote (HTTP) - Connect to hosted servers", value: "http" },
  { label: "Remote (SSE) - Real-time streaming", value: "sse" },
];

export function AddServerScreen({ onBack }: AddServerScreenProps): React.ReactElement {
  const { theme } = useTheme();
  useApp(); // keep the Ink app alive

  const configService = getConfigService();
  const testingService = getTestingService();

  const refreshDaemonIfRunning = useCallback(() => {
    const daemonService = getDaemonService();
    if (daemonService.isDaemonRunning().running) {
      daemonService.refreshDaemon().catch((error) => {
        console.error("Failed to refresh daemon after server changes:", error);
      });
    }
  }, []);

  const [form, setForm] = useState<ServerFormFields>(() => createServerFormFields());
  const [step, setStep] = useState(Step.Name);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; toolCount?: number; error?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const updateForm = useCallback((changes: Partial<ServerFormFields>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      if (step === Step.Name) {
        onBack();
        return;
      }

      switch (step) {
        case Step.Type:
          setStep(Step.Name);
          break;
        case Step.Command:
          setStep(Step.Type);
          break;
        case Step.Args:
          setStep(Step.Command);
          break;
        case Step.Env:
          setStep(Step.Args);
          break;
        case Step.Url:
          setStep(Step.Type);
          break;
        case Step.Token:
          setStep(Step.Url);
          break;
        case Step.OauthToggle:
          setStep(Step.Token);
          break;
        case Step.ClientId:
          setStep(Step.OauthToggle);
          break;
        case Step.ClientSecret:
          setStep(Step.ClientId);
          break;
        case Step.Scopes:
          setStep(Step.ClientSecret);
          break;
        case Step.AuthServer:
          setStep(Step.Scopes);
          break;
        case Step.Done:
          if (!isTesting) {
            onBack();
          }
          break;
      }
      return;
    }

    if (step === Step.Done && testResult && !isTesting) {
      onBack();
    }
  });

  const saveLocalServer = useCallback(
    async (fields: ServerFormFields) => {
      const serverId = fields.serverId || configService.generateServerId(fields.name);
      const prepared = prepareLocalServer(fields, serverId);
      if (!prepared.success || !prepared.data) {
        setError(prepared.error || "Failed to add server");
        return;
      }

      const result = configService.addLocalServer(prepared.data);
      if (!result.success) {
        setError(result.error || "Failed to add server");
        return;
      }

      setStep(Step.Testing);
      setTestResult(null);
      setIsTesting(true);

      try {
        const test = await testingService.testLocalServer(prepared.data);
        setTestResult(test);
      } catch (err) {
        setTestResult({
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsTesting(false);
        setStep(Step.Done);
        refreshDaemonIfRunning();
      }
    },
    [configService, refreshDaemonIfRunning, testingService]
  );

  const finalizeRemoteServer = useCallback(
    async (fields: ServerFormFields) => {
      const serverId = fields.serverId || configService.generateServerId(fields.name);
      const prepared = prepareRemoteServer(fields, serverId);
      if (!prepared.success || !prepared.data) {
        setError(prepared.error || "Failed to add server");
        return;
      }

      const result = configService.addRemoteServer(prepared.data);
      if (!result.success) {
        setError(result.error || "Failed to add server");
        return;
      }

      setStep(Step.Testing);
      setTestResult(null);
      setIsTesting(true);

      try {
        const test = await testingService.testRemoteServer(prepared.data, true);
        if (test.requiresAuth) {
          setStep(Step.Authenticating);
          await configService.updateRemoteServer(prepared.data.id, { oauth: { enabled: true } });
          const updatedServer = { ...prepared.data, oauth: { enabled: true } };
          const authService = getAuthService();
          const flow = await authService.startOAuthFlow(updatedServer, test.authRequirements);

          if (flow) {
            try {
              await open(flow.authUrl);
            } catch {
              // Ignore browser open errors
            }
            const authResult = await authService.waitForAuth(flow.state);
            authService.stopCallbackServer();

            if (authResult.success) {
              const retest = await testingService.testRemoteServer(updatedServer);
              setTestResult(retest);
            } else {
              setTestResult({
                success: false,
                error: authResult.error || "Authentication failed",
              });
            }
          } else {
            setTestResult({ success: false, error: "Could not start OAuth flow" });
          }
        } else {
          setTestResult(test);
        }
      } catch (err) {
        setTestResult({
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        setIsTesting(false);
        setStep(Step.Done);
        refreshDaemonIfRunning();
      }
    },
    [configService, refreshDaemonIfRunning, testingService]
  );

  const handleNameSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        setError("Name is required");
        return;
      }
      const lower = trimmed.toLowerCase();
      const exists = [...configService.getLocalServers(), ...configService.getRemoteServers()].some(
        (server) => server.name.toLowerCase() === lower
      );
      if (exists) {
        setError(`Server '${trimmed}' already exists`);
        return;
      }

      const serverId = configService.generateServerId(trimmed);
      updateForm({ name: trimmed, serverId });
      setError(null);
      setStep(Step.Type);
    },
    [configService, updateForm]
  );

  const handleTypeSelect = useCallback(
    (item: { value: string }) => {
      const serverType = item.value as ServerFormFields["serverType"];
      updateForm({ serverType });
      setError(null);
      setStep(serverType === "stdio" ? Step.Command : Step.Url);
    },
    [updateForm]
  );

  const handleCommandSubmit = useCallback(
    (value: string) => {
      updateForm({ command: value.trim() });
      setError(null);
      setStep(Step.Args);
    },
    [updateForm]
  );

  const handleArgsSubmit = useCallback(
    (value: string) => {
      updateForm({ args: value.trim() });
      setError(null);
      setStep(Step.Env);
    },
    [updateForm]
  );

  const handleEnvSubmit = useCallback(
    (value: string) => {
      setForm((prev) => {
        const next = { ...prev, env: value.trim() };
        void saveLocalServer(next);
        return next;
      });
      setError(null);
    },
    [saveLocalServer]
  );

  const handleUrlSubmit = useCallback(
    (value: string) => {
      updateForm({ url: value.trim() });
      setError(null);
      setStep(Step.Token);
    },
    [updateForm]
  );

  const handleTokenSubmit = useCallback(
    (value: string) => {
      updateForm({ token: value.trim() });
      setError(null);
      setStep(Step.OauthToggle);
    },
    [updateForm]
  );

  const handleOauthToggle = useCallback(
    (input: string) => {
      const answer = input.trim().toLowerCase();
      const enable = answer === "y" || answer === "yes";
      setForm((prev) => {
        const next = { ...prev, oauthEnabled: enable };
        if (!enable) {
          void finalizeRemoteServer(next);
        }
        return next;
      });
      setError(null);
      setStep(enable ? Step.ClientId : Step.Testing);
    },
    [finalizeRemoteServer]
  );

  const handleClientIdSubmit = useCallback(
    (value: string) => {
      updateForm({ clientId: value.trim() });
      setError(null);
      setStep(Step.ClientSecret);
    },
    [updateForm]
  );

  const handleClientSecretSubmit = useCallback(
    (value: string) => {
      updateForm({ clientSecret: value.trim() });
      setError(null);
      setStep(Step.Scopes);
    },
    [updateForm]
  );

  const handleScopesSubmit = useCallback(
    (value: string) => {
      updateForm({ scopes: value.trim() });
      setError(null);
      setStep(Step.AuthServer);
    },
    [updateForm]
  );

  const handleAuthServerSubmit = useCallback(
    (value: string) => {
      setForm((prev) => {
        const next = { ...prev, authServerUrl: value.trim() };
        void finalizeRemoteServer(next);
        return next;
      });
      setError(null);
    },
    [finalizeRemoteServer]
  );

  // Build summary of completed fields for context
  const completedFields: Array<{ label: string; value: string }> = [];
  if (form.name && step !== Step.Name) completedFields.push({ label: "Name", value: form.name });
  if (form.serverType && step !== Step.Type) completedFields.push({ label: "Type", value: form.serverType });
  if (form.serverType === "stdio") {
    if (form.command && ![Step.Name, Step.Type, Step.Command].includes(step)) completedFields.push({ label: "Command", value: form.command });
    if (form.args && ![Step.Name, Step.Type, Step.Command, Step.Args].includes(step)) completedFields.push({ label: "Args", value: form.args });
  } else if (form.serverType) {
    if (form.url && ![Step.Name, Step.Type, Step.Url].includes(step)) completedFields.push({ label: "URL", value: form.url });
  }

  const currentSteps = form.serverType === "stdio" ? LOCAL_STEPS
    : form.oauthEnabled ? REMOTE_OAUTH_STEPS
    : form.serverType ? REMOTE_STEPS
    : LOCAL_STEPS;
  const currentStepIdx = currentSteps.indexOf(step);
  const isFormStep = currentStepIdx >= 0;
  const stepProgress = isFormStep ? `Step ${currentStepIdx + 1}/${currentSteps.length}` : "";

  const titleLabel = `Add Server — ${STEP_LABELS[step]}`;

  return (
    <ScreenLayout title={titleLabel} shortcuts={[{ key: "ESC", label: "Go back" }]}>
      {/* Step progress indicator */}
      {isFormStep && (
        <Box marginBottom={1} gap={1}>
          <Text dimColor>{stepProgress}</Text>
          <Text dimColor>
            {currentSteps.map((_s, i) => i <= currentStepIdx ? "●" : "○").join(" ")}
          </Text>
        </Box>
      )}

      {/* Summary of previous answers */}
      {completedFields.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {completedFields.map((field) => (
            <Box key={field.label} gap={1}>
              <Text dimColor>{field.label}:</Text>
              <Text color={theme.colors.success}>{field.value}</Text>
            </Box>
          ))}
        </Box>
      )}

      {step === Step.Name && (
        <Box flexDirection="column">
          <Text bold>Server name:</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.name}
              onChange={(value) => updateForm({ name: value })}
              onSubmit={handleNameSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Type && (
        <Box flexDirection="column">
          <Text bold>Server type:</Text>
          <Box marginTop={1}>
            <SelectInput items={SERVER_TYPE_OPTIONS} onSelect={handleTypeSelect} />
          </Box>
        </Box>
      )}

      {step === Step.Command && (
        <Box flexDirection="column">
          <Text bold>Command executable:</Text>
          <Text dimColor>Examples: npx, node, python, uvx</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.command}
              onChange={(value) => updateForm({ command: value })}
              onSubmit={handleCommandSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Args && (
        <Box flexDirection="column">
          <Text bold>Arguments (space separated, optional):</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.args}
              onChange={(value) => updateForm({ args: value })}
              onSubmit={handleArgsSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Env && (
        <Box flexDirection="column">
          <Text bold>Environment variables (optional):</Text>
          <Text dimColor>
            Format: KEY=VALUE pairs, separated by space or comma. Leave blank to skip.
          </Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.env}
              onChange={(value) => updateForm({ env: value })}
              onSubmit={handleEnvSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Url && (
        <Box flexDirection="column">
          <Text bold>Server URL:</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.url}
              onChange={(value) => updateForm({ url: value })}
              onSubmit={handleUrlSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Token && (
        <Box flexDirection="column">
          <Text bold>Bearer token (optional):</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.token}
              onChange={(value) => updateForm({ token: value })}
              onSubmit={handleTokenSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.OauthToggle && (
        <Box flexDirection="column">
          <Text bold>Enable OAuth? (y/N)</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.oauthEnabled ? "y" : ""}
              onChange={(value) =>
                updateForm({ oauthEnabled: value.trim().toLowerCase().startsWith("y") })
              }
              onSubmit={handleOauthToggle}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Leave blank for 'N'</Text>
          </Box>
        </Box>
      )}

      {step === Step.ClientId && (
        <Box flexDirection="column">
          <Text bold>OAuth Client ID (optional):</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.clientId}
              onChange={(value) => updateForm({ clientId: value })}
              onSubmit={handleClientIdSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.ClientSecret && (
        <Box flexDirection="column">
          <Text bold>OAuth Client Secret (optional):</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.clientSecret}
              onChange={(value) => updateForm({ clientSecret: value })}
              onSubmit={handleClientSecretSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Scopes && (
        <Box flexDirection="column">
          <Text bold>OAuth Scopes (comma or space separated, optional):</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.scopes}
              onChange={(value) => updateForm({ scopes: value })}
              onSubmit={handleScopesSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.AuthServer && (
        <Box flexDirection="column">
          <Text bold>Auth Server URL (optional, overrides discovery):</Text>
          <Box marginTop={1}>
            <Text color={theme.colors.inputPrompt}>&gt; </Text>
            <TextInput
              value={form.authServerUrl}
              onChange={(value) => updateForm({ authServerUrl: value })}
              onSubmit={handleAuthServerSubmit}
            />
          </Box>
        </Box>
      )}

      {step === Step.Testing && (
        <Box flexDirection="column" paddingY={1}>
          <Box>
            <Text color={theme.colors.success}>✓</Text>
            <Text> Server '{form.name}' added!</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.colors.primary}>
              <Spinner type="dots" />
            </Text>
            <Text> Testing {form.name}...</Text>
          </Box>
        </Box>
      )}

      {step === Step.Authenticating && (
        <Box flexDirection="column" paddingY={1}>
          <Box>
            <Text color={theme.colors.success}>✓</Text>
            <Text> Server '{form.name}' added!</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.colors.warning}>○</Text>
            <Text> Server requires authentication</Text>
          </Box>
          <Box marginTop={1}>
            <Text color={theme.colors.primary}>
              <Spinner type="dots" />
            </Text>
            <Text> Opening browser for authentication...</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Complete the authentication in your browser</Text>
          </Box>
        </Box>
      )}

      {step === Step.Done && (
        <Box flexDirection="column" paddingY={1}>
          <Box>
            <Text color={theme.colors.success}>✓</Text>
            <Text> Server '{form.name}' added!</Text>
          </Box>
          {testResult && (
            <Box flexDirection="column" marginTop={1}>
              {testResult.success ? (
                <Box>
                  <Text color={theme.colors.success}>✓ OK</Text>
                  <Text> ({testResult.toolCount} tools)</Text>
                </Box>
              ) : (
                <Box>
                  <Text color={theme.colors.error}>✗ FAILED</Text>
                  <Text> - {testResult.error}</Text>
                </Box>
              )}
              <Box marginTop={1}>
                <Text dimColor>Press any key to continue...</Text>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={theme.colors.error}>Error: {error}</Text>
        </Box>
      )}
    </ScreenLayout>
  );
}

export default AddServerScreen;
