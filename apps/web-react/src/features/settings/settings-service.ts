import type { ExposureStatus, WorkspaceSummary } from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';

export interface SettingsData {
  adminSettings: Record<string, unknown>;
  exposure: ExposureStatus;
  commandFamilies: Record<string, string>;
  networkRules: Array<Record<string, unknown>>;
  execution: Record<string, unknown>;
  profiles: Array<Record<string, unknown>>;
  secretRefs: Array<Record<string, unknown> | string>;
  workspaces: WorkspaceSummary[];
}

export async function loadSettings(signal?: AbortSignal): Promise<SettingsData> {
  const options = signal ? { signal } : {};
  const [
    adminSettings,
    exposure,
    commandFamilies,
    networkRules,
    execution,
    profiles,
    secretRefs,
    workspaces,
  ] = await Promise.all([
    requestJson<Record<string, unknown>>('/api/settings', options),
    requestJson<ExposureStatus>('/api/exposure/status', options),
    requestJson<Record<string, string>>('/api/policy/command-families', options),
    requestJson<Array<Record<string, unknown>>>('/api/policy/network-rules', options),
    requestJson<Record<string, unknown>>('/api/execution-settings', options),
    requestJson<Array<Record<string, unknown>>>('/api/environment-profiles', options),
    requestJson<Array<Record<string, unknown> | string>>('/api/secret-references', options),
    requestJson<WorkspaceSummary[]>('/api/workspaces', options),
  ]);
  return {
    adminSettings,
    exposure,
    commandFamilies,
    networkRules,
    execution,
    profiles,
    secretRefs,
    workspaces,
  };
}

export async function postJson(path: string, value: unknown) {
  await requestJson(path, { method: 'POST', body: JSON.stringify(value) });
}

export async function patchJson(path: string, value: unknown) {
  await requestJson(path, { method: 'PATCH', body: JSON.stringify(value) });
}

export async function deleteResource(path: string) {
  await requestJson(path, { method: 'DELETE' });
}
