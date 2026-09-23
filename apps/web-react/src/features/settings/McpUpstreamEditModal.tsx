import { useState } from 'react';
import { SettingsFormModal } from './SettingsFormModal';

export type UpstreamTransport = 'stdio' | 'http' | 'sse';
export type UpstreamRiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
const RISK_TIERS: UpstreamRiskTier[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export interface UpstreamDraft {
  name: string;
  transport: UpstreamTransport;
  config: { command?: string; args?: string[]; cwd?: string; url?: string };
  auth: { header?: string; secretRefId?: string; env?: Record<string, string> } | undefined;
  risk: UpstreamRiskTier;
}

export function McpUpstreamEditModal({
  initial,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  initial?: Partial<UpstreamDraft>;
  submitting: boolean;
  error: string;
  onClose(): void;
  onSubmit(draft: UpstreamDraft): void;
}) {
  const [name, setName] = useState(initial?.name ?? ''),
    [transport, setTransport] = useState<UpstreamTransport>(initial?.transport ?? 'http');
  const [url, setUrl] = useState(initial?.config?.url ?? ''),
    [command, setCommand] = useState(initial?.config?.command ?? ''),
    [args, setArgs] = useState((initial?.config?.args ?? []).join(' ')),
    [cwd, setCwd] = useState(initial?.config?.cwd ?? '');
  const [header, setHeader] = useState(initial?.auth?.header ?? ''),
    [envName, setEnvName] = useState(Object.keys(initial?.auth?.env ?? {})[0] ?? ''),
    [secretRefId, setSecretRefId] = useState(
      initial?.auth?.secretRefId ?? Object.values(initial?.auth?.env ?? {})[0] ?? '',
    ),
    [risk, setRisk] = useState<UpstreamRiskTier>(initial?.risk ?? 'MEDIUM');
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const config =
      transport === 'stdio'
        ? {
            command: command.trim(),
            args: args.trim() ? args.trim().split(/\s+/) : [],
            ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          }
        : { url: url.trim() };
    const reference = secretRefId.trim();
    const auth = reference
      ? transport === 'stdio'
        ? envName.trim()
          ? { env: { [envName.trim()]: reference } }
          : undefined
        : header.trim()
          ? { header: header.trim(), secretRefId: reference }
          : undefined
      : undefined;
    onSubmit({ name: name.trim(), transport, config, auth, risk });
  };
  return (
    <SettingsFormModal
      title={initial?.name ? 'Edit MCP server' : 'Add MCP server'}
      description="Aevra connects to this server with its own credential and republishes its tools under the name you choose."
      submitting={submitting}
      submitLabel="Save server"
      submittingLabel="Connecting…"
      onClose={onClose}
      onSubmit={submit}
    >
      <div className="settings-modal-fields">
        <label className="field" htmlFor="upstreamName">
          <span>Server name</span>
        </label>
        <input
          id="upstreamName"
          value={name}
          required
          disabled={submitting}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="field" htmlFor="upstreamTransport">
          <span>Transport</span>
        </label>
        <select
          id="upstreamTransport"
          value={transport}
          disabled={submitting}
          onChange={(e) => setTransport(e.target.value as UpstreamTransport)}
        >
          <option value="http">Streamable HTTP</option>
          <option value="sse">HTTP + SSE (legacy)</option>
          <option value="stdio">Local process (stdio)</option>
        </select>
        {transport === 'stdio' ? (
          <>
            <label className="field" htmlFor="upstreamCommand">
              <span>Command to run</span>
            </label>
            <input
              id="upstreamCommand"
              value={command}
              required
              disabled={submitting}
              onChange={(e) => setCommand(e.target.value)}
            />
            <label className="field" htmlFor="upstreamArgs">
              <span>Arguments</span>
            </label>
            <input
              id="upstreamArgs"
              value={args}
              disabled={submitting}
              onChange={(e) => setArgs(e.target.value)}
            />
            <label className="field" htmlFor="upstreamCwd">
              <span>Working directory</span>
            </label>
            <input
              id="upstreamCwd"
              value={cwd}
              disabled={submitting}
              onChange={(e) => setCwd(e.target.value)}
            />
            <label className="field" htmlFor="upstreamEnvName">
              <span>Environment variable</span>
            </label>
            <input
              id="upstreamEnvName"
              value={envName}
              disabled={submitting}
              onChange={(e) => setEnvName(e.target.value)}
            />
          </>
        ) : (
          <>
            <label className="field" htmlFor="upstreamUrl">
              <span>Server URL</span>
            </label>
            <input
              id="upstreamUrl"
              value={url}
              required
              disabled={submitting}
              onChange={(e) => setUrl(e.target.value)}
            />
            <label className="field" htmlFor="upstreamHeader">
              <span>Header name</span>
            </label>
            <input
              id="upstreamHeader"
              value={header}
              disabled={submitting}
              onChange={(e) => setHeader(e.target.value)}
            />
          </>
        )}
        <label className="field" htmlFor="upstreamSecretRef">
          <span>Secret reference</span>
        </label>
        <input
          id="upstreamSecretRef"
          value={secretRefId}
          disabled={submitting}
          onChange={(e) => setSecretRefId(e.target.value)}
        />
        <p className="section-note">
          Name a reference stored under Secret references. Aevra resolves it only when it connects.
        </p>
        <label className="field" htmlFor="upstreamRisk">
          <span>Risk tier</span>
        </label>
        <select
          id="upstreamRisk"
          value={risk}
          disabled={submitting}
          onChange={(e) => setRisk(e.target.value as UpstreamRiskTier)}
        >
          {RISK_TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
        {error ? (
          <p role="alert" className="inline-result warning-text">
            {error}
          </p>
        ) : null}
      </div>
    </SettingsFormModal>
  );
}
