import type { ExposureStatus, KeepAwakeStatus, WorkspaceSummary } from '@aevra/admin-contracts';
import { requestJson } from '../../services/api-client';
import type { YoloMode } from './YoloPolicySettings';

export interface HookSetting {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  kind: string;
  execution: 'run' | 'launch';
  executable: string;
  args: string[];
  env?: Record<string, string>;
  permissions: string[];
  timeoutMs: number;
  failurePolicy: 'continue' | 'block';
}

export interface SettingsData {
  adminSettings: Record<string, unknown>;
  exposure: ExposureStatus;
  power: KeepAwakeStatus;
  commandFamilies: Record<string, string>;
  networkRules: Array<Record<string, unknown>>;
  execution: Record<string, unknown>;
  yolo: { mode: YoloMode };
  hooks: HookSetting[];
  profiles: Array<Record<string, unknown>>;
  secretRefs: Array<Record<string, unknown> | string>;
  workspaces: WorkspaceSummary[];
}

export async function loadSettings(signal?: AbortSignal): Promise<SettingsData> {
  const options = signal ? { signal } : {};
  const [
    adminSettings,
    exposure,
    power,
    commandFamilies,
    networkRules,
    execution,
    yolo,
    hooks,
    profiles,
    secretRefs,
    workspaces,
  ] = await Promise.all([
    requestJson<Record<string, unknown>>('/api/settings', options),
    requestJson<ExposureStatus>('/api/exposure/status', options),
    requestJson<KeepAwakeStatus>('/api/power/keep-awake', options),
    requestJson<Record<string, string>>('/api/policy/command-families', options),
    requestJson<Array<Record<string, unknown>>>('/api/policy/network-rules', options),
    requestJson<Record<string, unknown>>('/api/execution-settings', options),
    // Tolerated on its own: a core without this route must not blank the whole
    // Settings page, and the narrow mode is the safe assumption.
    requestJson<{ mode: YoloMode }>('/api/policy/yolo', options).catch(
      () => ({ mode: 'workspace' }) as { mode: YoloMode },
    ),
    requestJson<HookSetting[]>('/api/hooks', options),
    requestJson<Array<Record<string, unknown>>>('/api/environment-profiles', options),
    requestJson<Array<Record<string, unknown> | string>>('/api/secret-references', options),
    requestJson<WorkspaceSummary[]>('/api/workspaces', options),
  ]);
  return {
    adminSettings,
    exposure,
    power,
    commandFamilies,
    networkRules,
    execution,
    yolo: { mode: yolo?.mode === 'unrestricted' ? 'unrestricted' : 'workspace' },
    hooks,
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
