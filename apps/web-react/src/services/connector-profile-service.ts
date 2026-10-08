import type { ConnectorProfile, ConnectorProfilesResponse } from '@aevra/admin-contracts';
import { requestJson } from './api-client';

export function fetchConnectorProfiles(): Promise<ConnectorProfilesResponse> {
  return requestJson<ConnectorProfilesResponse>('/api/connector-profiles');
}

export function saveConnectorProfile(
  actor: string,
  profile: ConnectorProfile,
): Promise<{ actor: string; profile: ConnectorProfile }> {
  return requestJson(`/api/connector-profiles/${encodeURIComponent(actor)}`, {
    method: 'PUT',
    body: JSON.stringify(profile),
  });
}
