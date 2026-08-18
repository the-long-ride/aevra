import type {
  ApprovalItem,
  OauthRequestItem,
  RuntimeHealthStatus,
} from '@aevra/admin-contracts';
import { useEffect, useState } from 'react';
import { requestJson } from '../services/api-client';

export interface RuntimeHeaderState {
  status: RuntimeHealthStatus;
  pendingCount: number;
}

const unavailable: RuntimeHealthStatus = {
  core: 'unavailable',
  worker: 'unavailable',
  mcp: 'unavailable',
  tunnel: 'unavailable',
};

export function useRuntimeStatus(): RuntimeHeaderState {
  const [state, setState] = useState<RuntimeHeaderState>({
    status: {},
    pendingCount: 0,
  });

  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      try {
        const [status, approvals, oauth] = await Promise.all([
          requestJson<RuntimeHealthStatus>('/api/status'),
          requestJson<ApprovalItem[]>('/api/approvals'),
          requestJson<OauthRequestItem[]>('/api/oauth/requests'),
        ]);
        if (!stopped) {
          setState({
            status,
            pendingCount:
              approvals.filter((item) => item.state === 'PENDING').length +
              oauth.length,
          });
        }
      } catch {
        if (!stopped) setState({ status: unavailable, pendingCount: 0 });
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
