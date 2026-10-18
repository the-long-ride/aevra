import {
  TUNNEL_TOOL_DOWNLOADS,
  type TunnelToolId,
  type TunnelToolsStatus,
} from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { loadTunnelTools } from './welcome-service';

type Check =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; tools: TunnelToolsStatus };

const TOOL_IDS: TunnelToolId[] = ['cloudflared', 'ngrok'];
const LABELS: Record<TunnelToolId, string> = {
  cloudflared: 'Cloudflare Tunnel (cloudflared)',
  ngrok: 'ngrok',
};
const FRIENDLY: Record<TunnelToolId, string> = { cloudflared: 'Cloudflare Tunnel', ngrok: 'ngrok' };

function useTunnelCheck(): Check {
  const [check, setCheck] = useState<Check>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    loadTunnelTools().then(
      (tools) => active && setCheck({ state: 'ready', tools }),
      () => active && setCheck({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);
  return check;
}

function Badge({ check, id }: { check: Check; id: TunnelToolId }) {
  if (check.state === 'loading') return <span className="badge">Checking</span>;
  if (check.state === 'error') return <span className="badge">Unknown</span>;
  return check.tools[id].available ? (
    <span className="badge good">Ready</span>
  ) : (
    <span className="badge">Not found</span>
  );
}

function Suggestion({ check }: { check: Check }) {
  if (check.state === 'loading') {
    return (
      <p className="welcome-status" role="status">
        {'Checking this device…'}
      </p>
    );
  }
  if (check.state === 'error') {
    return (
      <p className="welcome-status" role="status">
        {"Couldn't check right now. You can still set up remote access in Settings."}
      </p>
    );
  }
  const { recommended, cloudflared, ngrok } = check.tools;
  if (recommended) {
    const both = cloudflared.available && ngrok.available ? 'Both are ready. ' : '';
    return (
      <p className="welcome-status" role="status">
        {`${both}We'll use ${FRIENDLY[recommended]}; it's ready on this device.`}
      </p>
    );
  }
  return (
    <div className="welcome-status" role="status">
      <p>
        Neither tool is installed yet. Install cloudflared (recommended, free) or ngrok, then finish
        the setup in Settings. This step is optional: Aevra works on this computer without a tunnel.
      </p>
      <p className="welcome-links">
        <a href={TUNNEL_TOOL_DOWNLOADS.cloudflared} target="_blank" rel="noreferrer">
          Get cloudflared
        </a>
        <a href={TUNNEL_TOOL_DOWNLOADS.ngrok} target="_blank" rel="noreferrer">
          Get ngrok
        </a>
      </p>
    </div>
  );
}

export function TunnelCheck() {
  const check = useTunnelCheck();
  return (
    <section className="welcome-section">
      <h3>Want to reach Aevra from anywhere?</h3>
      <p>A tunnel gives Aevra a secure public web address, so AI apps in the cloud can reach it.</p>
      <ul className="welcome-tunnel-list">
        {TOOL_IDS.map((id) => (
          <li key={id} className="welcome-tunnel-row" data-surface-id={`welcome:tunnel-${id}`}>
            <span>
              {LABELS[id]}
              {check.state === 'ready' && check.tools[id].version ? (
                <small className="muted"> {check.tools[id].version}</small>
              ) : null}
            </span>
            <Badge check={check} id={id} />
          </li>
        ))}
      </ul>
      <Suggestion check={check} />
    </section>
  );
}
