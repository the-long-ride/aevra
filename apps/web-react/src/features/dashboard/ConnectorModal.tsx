import type { WorkspaceSummary } from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { useModalLayer } from '../../components/modal-layer';
import { useToast } from '../../components/Toast';
import { requestJson } from '../../services/api-client';
import { CheckIcon, CopyIcon } from '../workspaces/WorkspaceIcons';

export function ConnectorModal({
  open,
  onClose,
  onCreated,
  workspaces = [],
}: {
  open: boolean;
  onClose(): void;
  onCreated(): Promise<void>;
  workspaces?: WorkspaceSummary[];
}) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [selectedWsToAdd, setSelectedWsToAdd] = useState('');
  const [grantedWorkspaceIds, setGrantedWorkspaceIds] = useState<string[]>([]);
  const [profileCap, setProfileCap] = useState('');
  const [token, setToken] = useState('');
  const [createdName, setCreatedName] = useState('');
  const [createdTransport, setCreatedTransport] = useState<'http' | 'stdio'>('http');
  const [publicUrl, setPublicUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);
  const [copiedTunnel, setCopiedTunnel] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  const { toast, success, error } = useToast();
  const { ref: layerRef, isTop } = useModalLayer();

  const addWorkspace = (id: string) => {
    if (!id || grantedWorkspaceIds.includes(id)) return;
    setGrantedWorkspaceIds((prev) => [...prev, id]);
    setSelectedWsToAdd('');
  };

  const revokeWorkspace = (id: string) => {
    setGrantedWorkspaceIds((prev) => prev.filter((wsId) => wsId !== id));
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    requestJson<{ publicUrl?: string; config?: { publicUrl?: string } }>('/api/exposure/status')
      .then((data) => {
        if (!active) return;
        const url = data?.publicUrl || data?.config?.publicUrl;
        if (url) setPublicUrl(url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTop()) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTop, onClose, open]);

  useEffect(() => {
    if (!open) {
      setName('');
      setTransport('http');
      setSelectedWsToAdd('');
      setGrantedWorkspaceIds([]);
      setProfileCap('');
      setToken('');
      setCreatedName('');
      setCreatedTransport('http');
      setCopiedToken(false);
      setCopiedLocal(false);
      setCopiedTunnel(false);
      setCopiedSnippet(false);
      setSubmitting(false);
    }
  }, [open]);

  if (!open) return null;

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const payload: {
        name: string;
        workspaceId?: string | null;
        workspaceIds?: string[];
        profileCap?: string | null;
      } = {
        name: trimmed,
        ...(grantedWorkspaceIds.length > 0 ? { workspaceId: grantedWorkspaceIds[0] } : {}),
        ...(grantedWorkspaceIds.length > 1 ? { workspaceIds: grantedWorkspaceIds } : {}),
        ...(profileCap ? { profileCap } : {}),
      };
      const created = await requestJson<{ token: string }>('/api/connectors', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setToken(created.token);
      setCreatedName(trimmed);
      setCreatedTransport(transport);
      success('Connector created.');
      await onCreated();
    } catch (cause) {
      error(cause);
    } finally {
      setSubmitting(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3000';
  const localMcpUrl = `${origin}/mcp`;
  const tunnelMcpUrl = publicUrl ? `${publicUrl.replace(/\/$/, '')}/mcp` : `${origin}/mcp`;

  const httpLocalSnippet = JSON.stringify(
    {
      mcpServers: {
        [createdName || 'aevra']: {
          url: localMcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );

  const httpTunnelSnippet = JSON.stringify(
    {
      mcpServers: {
        [createdName || 'aevra']: {
          url: tunnelMcpUrl,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    },
    null,
    2,
  );

  const stdioSnippet = JSON.stringify(
    {
      mcpServers: {
        [createdName || 'aevra']: {
          command: 'aevra',
          args: ['agent', 'serve'],
        },
      },
    },
    null,
    2,
  );

  return (
    <div ref={layerRef} className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        style={{ width: 'min(860px, calc(100vw - 32px))' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <h2 id="connector-modal-title">Create Bearer connector</h2>
            <p className="muted">
              Configure client admission credentials, workspace binding, and capability profile.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          {token ? (
            <div className="secret-result">
              <b>Copy this token now. It is shown once.</b>
              <code>{token}</code>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(token);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                >
                  {copiedToken ? 'Copied!' : 'Copy token'}
                </button>
              </div>

              {createdTransport === 'http' ? (
                <div style={{ marginTop: '14px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>
                    MCP client configuration (Claude Desktop, Cursor, etc.):
                  </span>
                  <div className="connector-snippets-grid">
                    <div className="snippet-card">
                      <div className="snippet-card-header">
                        <span className="snippet-title">Local configuration</span>
                        <button
                          type="button"
                          className="snippet-copy-icon-btn"
                          aria-label="Copy local snippet"
                          title={copiedLocal ? 'Copied!' : 'Copy local snippet'}
                          onClick={async () => {
                            await navigator.clipboard.writeText(httpLocalSnippet);
                            setCopiedLocal(true);
                            setTimeout(() => setCopiedLocal(false), 2000);
                          }}
                        >
                          {copiedLocal ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </div>
                      <pre className="snippet-pre">{httpLocalSnippet}</pre>
                    </div>

                    <div className="snippet-card">
                      <div className="snippet-card-header">
                        <span className="snippet-title">Tunnel / Remote configuration</span>
                        <button
                          type="button"
                          className="snippet-copy-icon-btn"
                          aria-label="Copy tunnel snippet"
                          title={copiedTunnel ? 'Copied!' : 'Copy tunnel snippet'}
                          onClick={async () => {
                            await navigator.clipboard.writeText(httpTunnelSnippet);
                            setCopiedTunnel(true);
                            setTimeout(() => setCopiedTunnel(false), 2000);
                          }}
                        >
                          {copiedTunnel ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </div>
                      <pre className="snippet-pre">{httpTunnelSnippet}</pre>
                    </div>
                  </div>
                  {!publicUrl ? (
                    <p className="muted" style={{ fontSize: '11px', margin: '6px 0 0' }}>
                      Tunnel URL placeholder shown. Configure Cloudflare or ngrok in Settings →
                      Remote Access for your live public endpoint.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div style={{ marginTop: '14px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>
                    Local process configuration (stdio):
                  </span>
                  <div className="snippet-card" style={{ marginTop: '6px' }}>
                    <div className="snippet-card-header">
                      <span className="snippet-title">stdio configuration</span>
                      <button
                        type="button"
                        className="snippet-copy-icon-btn"
                        aria-label="Copy snippet"
                        title={copiedSnippet ? 'Copied!' : 'Copy snippet'}
                        onClick={async () => {
                          await navigator.clipboard.writeText(stdioSnippet);
                          setCopiedSnippet(true);
                          setTimeout(() => setCopiedSnippet(false), 2000);
                        }}
                      >
                        {copiedSnippet ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    </div>
                    <pre className="snippet-pre">{stdioSnippet}</pre>
                  </div>
                  <p className="muted" style={{ fontSize: '11px', margin: '4px 0 0' }}>
                    Tip: For automatic 1-click injection into detected local coding agents, see{' '}
                    <b>Settings → Agent Integrations</b>.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <form className="stack-form" onSubmit={create}>
              <label className="field">
                <span>Connector name</span>
                <input
                  placeholder="Connector name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  required
                />
              </label>

              <label className="field">
                <span>Connection type</span>
                <select
                  aria-label="Connection type"
                  value={transport}
                  onChange={(event) => setTransport(event.currentTarget.value as 'http' | 'stdio')}
                >
                  <option value="http">HTTP / SSE (Remote / Web AI clients)</option>
                  <option value="stdio">stdio (Local CLI / coding agents)</option>
                </select>
              </label>

              <div className="field">
                <span>Workspaces</span>
                {grantedWorkspaceIds.length ? (
                  <ul
                    className="connection-workspaces-list"
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: '6px 0 10px',
                      display: 'grid',
                      gap: '6px',
                    }}
                  >
                    {grantedWorkspaceIds.map((id) => {
                      const ws = workspaces.find((w) => w.id === id);
                      const label = ws ? `${ws.name} (${ws.hostRoot})` : id;
                      return (
                        <li
                          key={id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 10px',
                            background: 'var(--canvas-subtle, rgba(255,255,255,0.05))',
                            borderRadius: '4px',
                            border: '1px solid var(--hairline)',
                          }}
                        >
                          <span style={{ fontSize: '13px' }}>{label}</span>
                          <button
                            type="button"
                            className="danger-button"
                            aria-label={`Revoke ${ws?.name ?? id}`}
                            title="Remove"
                            onClick={() => revokeWorkspace(id)}
                          >
                            [x]
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="muted" style={{ fontSize: '12px', margin: '4px 0 8px' }}>
                    No workspaces granted (default: none granted).
                  </p>
                )}

                <div style={{ display: 'flex', gap: '8px' }}>
                  <select
                    aria-label="Workspace binding"
                    value={selectedWsToAdd}
                    onChange={(event) => {
                      const val = event.currentTarget.value;
                      if (val) {
                        addWorkspace(val);
                      }
                    }}
                    style={{ flex: 1 }}
                  >
                    <option value="">
                      {grantedWorkspaceIds.length
                        ? '+ Add another workspace…'
                        : '+ Grant workspace…'}
                    </option>
                    {workspaces
                      .filter((ws) => !grantedWorkspaceIds.includes(ws.id))
                      .map((ws) => (
                        <option key={ws.id} value={ws.id}>
                          {ws.name} ({ws.hostRoot})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <label className="field">
                <span>Capability ceiling</span>
                <select
                  aria-label="Capability ceiling"
                  value={profileCap}
                  onChange={(event) => setProfileCap(event.currentTarget.value)}
                >
                  <option value="">Full access (all capabilities)</option>
                  <option value="read-only">Read-only (files.read, files.search)</option>
                  <option value="developer">Developer (files, commands, git)</option>
                </select>
              </label>

              {toast}
              <button
                className="primary"
                data-surface-id="connections:create-connector"
                disabled={submitting}
              >
                {submitting ? 'Creating…' : 'Create token'}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
