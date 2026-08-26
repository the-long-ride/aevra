import type { ExposureConfig, ExposureProvider, ExposureStatus } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { AdminWebUiSettings, type AdminProbeState } from './AdminWebUiSettings';
import { requestJson } from '../../services/api-client';
import { RemoteAccessPanel } from '../dashboard/RemoteAccessPanel';

const PROVIDERS = [
  { value: 'local', label: 'Local only' },
  { value: 'direct', label: 'Direct HTTPS' },
  { value: 'cloudflare', label: 'Cloudflare' },
  { value: 'ngrok', label: 'ngrok' },
  { value: 'external', label: 'External / Custom' },
] as const;

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value.trim();
  }
}

export function RemoteAccessSettings({
  status,
  onChanged,
}: {
  status: ExposureStatus;
  onChanged(): Promise<void>;
}) {
  const initial = status.config;
  const initialAdminPublicUrl = initial?.adminPublicUrl ?? status.adminPublicUrl ?? '';
  const initialPrimaryAdminOrigin = initialAdminPublicUrl
    ? normalizedOrigin(initialAdminPublicUrl)
    : '';
  const [provider, setProvider] = useState<ExposureProvider>(initial?.provider ?? status.provider);
  const [ownership, setOwnership] = useState<'managed' | 'external'>(
    initial?.cloudflare?.ownership ?? initial?.ngrok?.ownership ?? 'managed',
  );
  const [authMode, setAuthMode] = useState<'oauth' | 'access'>(
    initial?.cloudflare?.authMode ?? 'oauth',
  );
  const [ngrokDomainMode, setNgrokDomainMode] = useState<'automatic' | 'stable'>(
    initial?.ngrok?.domainMode ?? 'automatic',
  );
  const [adminPublicUrl, setAdminPublicUrl] = useState(initialAdminPublicUrl);
  const [trustedAdminOrigins, setTrustedAdminOrigins] = useState<string[]>(() => [
    ...new Set(
      (initial?.trustedAdminOrigins ?? [])
        .map(normalizedOrigin)
        .filter((origin) => origin !== initialPrimaryAdminOrigin),
    ),
  ]);
  const [newTrustedAdminOrigin, setNewTrustedAdminOrigin] = useState('');
  const [message, setMessage] = useState('');
  const [adminProbe, setAdminProbe] = useState<AdminProbeState | null>(null);

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const savedAdminPublicUrl = adminPublicUrl.trim();
    const effectiveTrustedOrigins = [
      ...trustedAdminOrigins.map(normalizedOrigin).filter(Boolean),
      ...(savedAdminPublicUrl ? [normalizedOrigin(savedAdminPublicUrl)] : []),
    ].filter((value, index, all) => all.indexOf(value) === index);
    const adminConfig = {
      ...(savedAdminPublicUrl ? { adminPublicUrl: savedAdminPublicUrl } : {}),
      ...(effectiveTrustedOrigins.length ? { trustedAdminOrigins: effectiveTrustedOrigins } : {}),
    };

    let config: ExposureConfig;
    if (provider === 'local') {
      config = { provider: 'local', ...adminConfig };
    } else if (provider === 'direct') {
      config = {
        provider,
        publicUrl: String(values.publicUrl ?? ''),
        direct: { host: String(values.host ?? '0.0.0.0') },
        ...adminConfig,
      };
    } else if (provider === 'external') {
      config = { provider, publicUrl: String(values.publicUrl ?? ''), ...adminConfig };
    } else if (provider === 'ngrok') {
      const stableManaged = ownership === 'managed' && ngrokDomainMode === 'stable';
      config = {
        provider,
        ...(ownership === 'external' || stableManaged
          ? { publicUrl: String(values.publicUrl ?? '') }
          : {}),
        ngrok: {
          ownership,
          ...(stableManaged ? { domainMode: 'stable' as const } : {}),
        },
        ...adminConfig,
      };
    } else {
      const hostname = String(values.hostname ?? '').trim();
      config = {
        provider,
        ...(hostname ? { publicUrl: `https://${hostname}` } : {}),
        cloudflare: {
          hostname: hostname || undefined,
          tunnelId: String(values.tunnelId ?? '').trim() || undefined,
          ownership,
          authMode,
          issuer:
            authMode === 'access' ? String(values.issuer ?? '').trim() || undefined : undefined,
          audience:
            authMode === 'access' ? String(values.audience ?? '').trim() || undefined : undefined,
        },
        ...adminConfig,
      };
    }

    try {
      await requestJson('/api/exposure/config', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      setMessage(`Exposure configured: ${provider}.`);
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const authenticateCloudflare = async () => {
    try {
      const result = await requestJson<{ message?: string }>('/api/cloudflare/authenticate', {
        method: 'POST',
        body: '{}',
      });
      setMessage(result.message ?? 'Cloudflare authentication completed.');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const testAdminUrl = async () => {
    try {
      const result = await requestJson<{
        configured: boolean;
        trusted: boolean;
        reachable: boolean;
        publicUrl?: string;
        message?: string;
      }>('/api/exposure/admin/test', {
        method: 'POST',
        body: JSON.stringify({
          publicUrl: adminPublicUrl.trim() || undefined,
          trustedOrigins: trustedAdminOrigins.map(normalizedOrigin),
        }),
      });
      if (result.reachable && result.trusted) {
        setAdminProbe({ tone: 'success', message: 'Reachable · Trusted' });
      } else if (result.reachable) {
        setAdminProbe({ tone: 'warning', message: 'Reachable · Not trusted' });
      } else {
        setAdminProbe({
          tone: 'error',
          message: result.message ?? 'Admin endpoint is not reachable',
        });
      }
    } catch (error) {
      setAdminProbe({
        tone: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const addTrustedOrigin = () => {
    const value = newTrustedAdminOrigin.trim();
    if (!value) return;
    const normalized = normalizedOrigin(value);
    const primaryOrigin = adminPublicUrl.trim() ? normalizedOrigin(adminPublicUrl) : '';
    if (normalized === primaryOrigin) {
      setNewTrustedAdminOrigin('');
      return;
    }
    setTrustedAdminOrigins((current) =>
      current.includes(normalized) ? current : [...current, normalized],
    );
    setNewTrustedAdminOrigin('');
  };

  const showMcpUrl =
    provider === 'direct' ||
    provider === 'external' ||
    (provider === 'ngrok' && (ownership === 'external' || ngrokDomainMode === 'stable'));

  return (
    <section className="panel remote-card">
      <div className="panel-head">
        <h3>Remote Access</h3>
      </div>
      <RemoteAccessPanel status={status} onChanged={onChanged} />
      <form className="remote-config" onSubmit={save}>
        <section className="remote-config-section">
          <div className="remote-config-section-head">
            <div>
              <h4>MCP / OAuth exposure</h4>
              <p>Configure the public endpoint used by MCP clients and OAuth metadata.</p>
            </div>
          </div>
          <div className="remote-config-grid">
            <label className="field">
              <span>Exposure provider</span>
              <Dropdown
                ariaLabel="Exposure provider"
                value={provider}
                onChange={(value) => setProvider(value as ExposureProvider)}
                options={PROVIDERS}
              />
            </label>

            {showMcpUrl ? (
              <label className="field">
                <span>Public MCP HTTPS URL</span>
                <input
                  name="publicUrl"
                  defaultValue={initial?.publicUrl ?? ''}
                  placeholder="https://aevra.example.com"
                  required
                />
              </label>
            ) : null}

            {provider === 'direct' ? (
              <label className="field">
                <span>Direct bind host</span>
                <input name="host" defaultValue={initial?.direct?.host ?? '0.0.0.0'} required />
              </label>
            ) : null}

            {provider === 'cloudflare' ? (
              <>
                <label className="field">
                  <span>Public Aevra hostname</span>
                  <input
                    name="hostname"
                    defaultValue={initial?.cloudflare?.hostname ?? ''}
                    required
                  />
                </label>
                <label className="field">
                  <span>Tunnel ID</span>
                  <input name="tunnelId" defaultValue={initial?.cloudflare?.tunnelId ?? ''} />
                </label>
              </>
            ) : null}

            {provider === 'cloudflare' || provider === 'ngrok' ? (
              <label className="field">
                <span>{provider === 'ngrok' ? 'ngrok ownership' : 'Tunnel ownership'}</span>
                <Dropdown
                  ariaLabel={provider === 'ngrok' ? 'ngrok ownership' : 'Tunnel ownership'}
                  value={ownership}
                  onChange={(value) => setOwnership(value as 'managed' | 'external')}
                  options={[
                    { value: 'managed', label: 'Managed by Aevra' },
                    { value: 'external', label: 'External process' },
                  ]}
                />
              </label>
            ) : null}

            {provider === 'ngrok' && ownership === 'managed' ? (
              <label className="field">
                <span>ngrok domain mode</span>
                <Dropdown
                  ariaLabel="ngrok domain mode"
                  value={ngrokDomainMode}
                  onChange={(value) => setNgrokDomainMode(value as 'automatic' | 'stable')}
                  options={[
                    { value: 'automatic', label: 'Automatic domain' },
                    { value: 'stable', label: 'Stable domain' },
                  ]}
                />
              </label>
            ) : null}

            {provider === 'cloudflare' ? (
              <>
                <label className="field">
                  <span>Cloudflare outer authentication</span>
                  <Dropdown
                    ariaLabel="Cloudflare outer authentication"
                    value={authMode}
                    onChange={(value) => setAuthMode(value as 'oauth' | 'access')}
                    options={[
                      { value: 'oauth', label: 'Aevra OAuth only' },
                      { value: 'access', label: 'Cloudflare Access plus Aevra' },
                    ]}
                  />
                </label>
                <label className="field">
                  <span>Access issuer</span>
                  <input name="issuer" defaultValue={initial?.cloudflare?.issuer ?? ''} />
                </label>
                <label className="field">
                  <span>Audience</span>
                  <input name="audience" defaultValue={initial?.cloudflare?.audience ?? ''} />
                </label>
              </>
            ) : null}
          </div>

          {provider === 'external' ? (
            <p className="remote-provider-hints" data-testid="external-provider-hints">
              Point any HTTPS reverse proxy or tunnel at the local Aevra gateway. Examples include
              Caddy, Tailscale Funnel, FRP, reverse SSH, another ngrok process, or a similar
              service. Aevra does not launch or manage these external processes.
            </p>
          ) : null}
        </section>

        <AdminWebUiSettings
          adminPublicUrl={adminPublicUrl}
          adminProbe={adminProbe}
          trustedAdminOrigins={trustedAdminOrigins}
          newTrustedAdminOrigin={newTrustedAdminOrigin}
          onAdminPublicUrlChange={(value) => {
            setAdminPublicUrl(value);
            setAdminProbe(null);
          }}
          onTest={testAdminUrl}
          onNewTrustedOriginChange={setNewTrustedAdminOrigin}
          onAddTrustedOrigin={addTrustedOrigin}
          onRemoveTrustedOrigin={(index) =>
            setTrustedAdminOrigins((current) =>
              current.filter((_, currentIndex) => currentIndex !== index),
            )
          }
        />

        <div className="remote-actions">
          <p className="inline-result">{message}</p>
          <div className="actions">
            {provider === 'cloudflare' ? (
              <button type="button" onClick={authenticateCloudflare}>
                Authenticate Cloudflare
              </button>
            ) : null}
            <button className="primary">Save remote access</button>
          </div>
        </div>
      </form>
    </section>
  );
}
