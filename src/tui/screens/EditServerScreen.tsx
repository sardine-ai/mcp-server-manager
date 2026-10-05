/**
 * EditServerScreen - Lightweight editor for existing MCP servers.
 * Supports both local (stdio) and remote servers with token redaction.
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import SelectInput from "ink-select-input";
import { ScreenLayout } from "../components/index.js";
import { getConfigService } from "../../services/config.service.js";
import { getDaemonService } from "../../services/daemon.service.js";
import type { LocalServer, RemoteServer, TransportType } from "../../types/index.js";
import { REDACTED_PLACEHOLDER } from "../../shared/redaction.js";
import { useTheme } from "../theme/index.js";
import {
  createServerFormFields,
  prepareLocalServerUpdates,
  prepareRemoteServerUpdates,
  ServerFormFields,
  Step,
} from "./server-form.js";

interface EditServerScreenProps {
  server: LocalServer | RemoteServer;
  type: "local" | "remote";
  onBack: () => void;
  onSaved: (server: LocalServer | RemoteServer) => void;
}

const REMOTE_TYPE_OPTIONS = [
  { label: "HTTP", value: "http" },
  { label: "SSE (streaming)", value: "sse" },
];

export function EditServerScreen({
  server,
  type,
  onBack,
  onSaved,
}: EditServerScreenProps): React.ReactElement {
  const { theme } = useTheme();
  const configService = getConfigService();
  const daemonService = getDaemonService();

  const initialForm = useMemo(
    () =>
      createServerFormFields({
        name: server.name,
        serverId: server.id,
        serverType: type === "local" ? "stdio" : (server as RemoteServer).type,
        command: type === "local" ? (server as LocalServer).command : "",
        args: type === "local" ? (server as LocalServer).args.join(" ") : "",
        env:
          type === "local" && (server as LocalServer).env
            ? Object.entries((server as LocalServer).env!)
                .map(([k, v]) => `${k}=${v}`)
                .join(" ")
            : "",
        url: type === "remote" ? (server as RemoteServer).url : "",
        token:
          type === "remote" && (server as RemoteServer).bearerToken
            ? REDACTED_PLACEHOLDER
            : "",
        oauthEnabled: type === "remote" ? Boolean((server as RemoteServer).oauth?.enabled) : false,
        clientId: type === "remote" ? (server as RemoteServer).oauth?.clientId || "" : "",
        clientSecret: type === "remote" ? (server as RemoteServer).oauth?.clientSecret || "" : "",
        scopes:
          type === "remote" && (server as RemoteServer).oauth?.scopes
            ? (server as RemoteServer).oauth!.scopes!.join(" ")
            : "",
        authServerUrl: type === "remote" ? (server as RemoteServer).oauth?.authServerUrl || "" : "",
      }),
    [server, type]
  );

  const [form, setForm] = useState(initialForm);
  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);
  const [step, setStep] = useState(Step.Name);
  const [error, setError] = useState<string | null>(null);

  const refreshDaemonIfRunning = useCallback(() => {
    if (daemonService.isDaemonRunning().running) {
      daemonService.refreshDaemon().catch(() => {
        // Swallow to avoid breaking the editor.
      });
    }
  }, [daemonService]);

  const updateForm = useCallback((changes: Partial<ServerFormFields>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  }, []);

  const saveLocalServer = useCallback(() => {
    const prepared = prepareLocalServerUpdates(form);
    if (!prepared.success || !prepared.data) {
      setError(prepared.error || "Failed to update server");
      return;
    }

    const result = configService.updateLocalServer(server.id, prepared.data);
    if (!result.success) {
      setError(result.error || "Failed to update server");
      return;
    }

    refreshDaemonIfRunning();
    onSaved({ ...(server as LocalServer), ...prepared.data });
  }, [configService, form, onSaved, refreshDaemonIfRunning, server]);

  const saveRemoteServer = useCallback(() => {
    const prepared = prepareRemoteServerUpdates(form);
    if (!prepared.success || !prepared.data) {
      setError(prepared.error || "Failed to update server");
      return;
    }

    const result = configService.updateRemoteServer(server.id, prepared.data);
    if (!result.success) {
      setError(result.error || "Failed to update server");
      return;
    }

    refreshDaemonIfRunning();
    onSaved({ ...(server as RemoteServer), ...prepared.data });
  }, [configService, form, onSaved, refreshDaemonIfRunning, server]);

  const handleSubmit = useCallback(() => {
    if (type === "local") {
      saveLocalServer();
    } else {
      saveRemoteServer();
    }
  }, [saveLocalServer, saveRemoteServer, type]);

  useInput((_input, key) => {
    if (!key.escape) return;

    if (step === Step.Name) {
      onBack();
      return;
    }

    if (type === "local") {
      if (step === Step.Command) {
        setStep(Step.Name);
      } else if (step === Step.Args) {
        setStep(Step.Command);
      } else if (step === Step.Env) {
        setStep(Step.Args);
      }
    } else {
      if (step === Step.Type) {
        setStep(Step.Name);
      } else if (step === Step.Url) {
        setStep(Step.Type);
      } else if (step === Step.Token) {
        setStep(Step.Url);
      } else if (step === Step.OauthToggle) {
        setStep(Step.Token);
      } else if (step === Step.ClientId) {
        setStep(Step.OauthToggle);
      } else if (step === Step.ClientSecret) {
        setStep(Step.ClientId);
      } else if (step === Step.Scopes) {
        setStep(Step.ClientSecret);
      } else if (step === Step.AuthServer) {
        setStep(Step.Scopes);
      }
    }
  });

  return (
    <ScreenLayout
      title="Edit MCP Server"
      subtitle={`Editing '${server.name}' (${type === "local" ? "stdio" : (server as RemoteServer).type})`}
      shortcuts={[{ key: "ESC", label: "Back" }]}
      footer={
        type === "remote" ? (
          <Text dimColor>
            Tokens are masked. Leave '{REDACTED_PLACEHOLDER}' to keep the existing token or clear the
            field to remove it.
          </Text>
        ) : undefined
      }
    >
      <Box flexDirection="column" gap={1}>
        {step === Step.Name && (
          <>
            <Text color={theme.colors.success}>Server name</Text>
            <TextInput
              value={form.name}
              onChange={(value) => updateForm({ name: value })}
              onSubmit={() => setStep(type === "local" ? Step.Command : Step.Type)}
            />
          </>
        )}

        {type === "local" && step === Step.Command && (
          <>
            <Text color={theme.colors.success}>Command</Text>
            <TextInput
              value={form.command}
              onChange={(value) => updateForm({ command: value })}
              onSubmit={() => setStep(Step.Args)}
            />
          </>
        )}

        {type === "local" && step === Step.Args && (
          <>
            <Text color={theme.colors.success}>Arguments</Text>
            <TextInput
              value={form.args}
              onChange={(value) => updateForm({ args: value })}
              onSubmit={() => setStep(Step.Env)}
            />
          </>
        )}

        {type === "local" && step === Step.Env && (
          <>
            <Text color={theme.colors.success}>Environment variables</Text>
            <Text dimColor>Format: KEY=VALUE pairs, separated by space or comma. Leave blank to clear.</Text>
            <TextInput value={form.env} onChange={(value) => updateForm({ env: value })} onSubmit={handleSubmit} />
          </>
        )}

        {type === "remote" && step === Step.Type && (
          <>
            <Text color={theme.colors.success}>Transport</Text>
            <SelectInput
              items={REMOTE_TYPE_OPTIONS}
              initialIndex={REMOTE_TYPE_OPTIONS.findIndex(
                (opt) => opt.value === form.serverType
              )}
              onSelect={(item) => {
                updateForm({ serverType: item.value as TransportType });
                setStep(Step.Url);
              }}
            />
          </>
        )}

        {type === "remote" && step === Step.Url && (
          <>
            <Text color={theme.colors.success}>URL</Text>
            <TextInput
              value={form.url}
              onChange={(value) => updateForm({ url: value })}
              onSubmit={() => setStep(Step.Token)}
            />
          </>
        )}

        {type === "remote" && step === Step.Token && (
          <>
            <Text color={theme.colors.success}>Bearer token (optional)</Text>
            <TextInput
              value={form.token}
              onChange={(value) => updateForm({ token: value })}
              onSubmit={() => setStep(Step.OauthToggle)}
            />
          </>
        )}

        {type === "remote" && step === Step.OauthToggle && (
          <>
            <Text color={theme.colors.success}>Enable OAuth? (y/N)</Text>
            <TextInput
              value={form.oauthEnabled ? "y" : ""}
              onChange={(value) => updateForm({ oauthEnabled: value.trim().toLowerCase().startsWith("y") })}
              onSubmit={(value) => {
                const enable = value.trim().toLowerCase().startsWith("y");
                updateForm({ oauthEnabled: enable });
                setStep(enable ? Step.ClientId : Step.Name);
                if (!enable) {
                  saveRemoteServer();
                }
              }}
            />
          </>
        )}

        {type === "remote" && step === Step.ClientId && (
          <>
            <Text color={theme.colors.success}>OAuth Client ID (optional)</Text>
            <TextInput
              value={form.clientId}
              onChange={(value) => updateForm({ clientId: value })}
              onSubmit={() => setStep(Step.ClientSecret)}
            />
          </>
        )}

        {type === "remote" && step === Step.ClientSecret && (
          <>
            <Text color={theme.colors.success}>OAuth Client Secret (optional)</Text>
            <TextInput
              value={form.clientSecret}
              onChange={(value) => updateForm({ clientSecret: value })}
              onSubmit={() => setStep(Step.Scopes)}
            />
          </>
        )}

        {type === "remote" && step === Step.Scopes && (
          <>
            <Text color={theme.colors.success}>OAuth Scopes (comma or space separated, optional)</Text>
            <TextInput
              value={form.scopes}
              onChange={(value) => updateForm({ scopes: value })}
              onSubmit={() => setStep(Step.AuthServer)}
            />
          </>
        )}

        {type === "remote" && step === Step.AuthServer && (
          <>
            <Text color={theme.colors.success}>Auth Server URL (optional)</Text>
            <TextInput
              value={form.authServerUrl}
              onChange={(value) => updateForm({ authServerUrl: value })}
              onSubmit={handleSubmit}
            />
          </>
        )}

        {error && (
          <Text color={theme.colors.error}>
            ✗ {error}
          </Text>
        )}

        <Text dimColor>ENTER to continue • ESC to go back</Text>
      </Box>
    </ScreenLayout>
  );
}

export default EditServerScreen;
