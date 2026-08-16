import type { ExposureConfig, ExposureProvider, ExposureStatus } from '@aevra/admin-contracts';
import { useState } from 'react';
import { Dropdown } from '../../components/Dropdown';
import { requestJson } from '../../services/api-client';
import { RemoteAccessPanel } from '../dashboard/RemoteAccessPanel';

const PROVIDERS = [
  { value: 'local', label: 'Local only' },
  { value: 'direct', label: 'Direct HTTPS' },
  { value: 'cloudflare', label: 'Cloudflare' },
  { value: 'ngrok', label: 'ngrok' },
  { value: 'external', label: 'External / Custom' },
] as const;

export function RemoteAccessSettings({
  status,
  onChanged,
}: {
  status: ExposureStatus;
  onChanged(): Promise<void>;
}) {
  const initial = status.config;
  const [provider, setProvider] = useState<ExposureProvider>(initial?.provider ?? status.provider);
  const [ownership, setOwnership] = useState<'managed' | 'external'>(
    initial?.cloudflare?.ownership ?? initial?.ngrok?.ownership ?? 'managed',
  );
  const [authMode, setAuthMode] = useState<'oauth' | 'access'>(
    initial?.cloudflare?.authMode ?? 'oauth',
  );
  const [message, setMessage] = useState('');

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    let config: ExposureConfig;
    if (provider === 'local') {
      config = { provider: 'local' };
    } else if (provider === 'direct') {
      config = {
        provider,
        publicUrl: String(values.publicUrl ?? ''),
        direct: { host: String(values.host ?? '0.0.0.0') },
      };
    } else if (provider === 'external') {
      config = { provider, publicUrl: String(values.publicUrl ?? '') };
    } else if (provider === 'ngrok') {
      config = {
        provider,
        ...(ownership === 'external' ? { publicUrl: String(values.publicUrl ?? '') } : {}),
        ngrok: { ownership },
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

  return (
    <section className="panel remote-card">
      <div className="panel-head">
        <h3>Remote Access</h3>
      </div>
      <RemoteAccessPanel status={status} onChanged={onChanged} />
      <form className="remote-config" onSubmit={save}>
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

          {provider === 'direct' ||
          provider === 'external' ||
          (provider === 'ngrok' && ownership === 'external') ? (
            <label className="field">
              <span>Public HTTPS URL</span>
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
            Caddy, Tailscale Funnel, FRP, reverse SSH, another ngrok process, or a similar service.
            Aevra does not launch or manage these external processes.
          </p>
        ) : null}

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
