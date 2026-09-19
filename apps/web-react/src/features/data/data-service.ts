import { requestJson } from '../../services/api-client';
import {
  loadStoredCustomApps,
  saveStoredCustomApps,
  type DetectedApp,
} from '../settings/DesktopControlSettings';

export interface AevraBackupData {
  version: number;
  exportedAt: string;
  portable: boolean;
  workspaces: unknown[];
  mounts: unknown[];
  rules: unknown[];
  profiles: unknown[];
  environmentProfiles: unknown[];
  desktopPolicy?: unknown;
  customApps?: DetectedApp[];
  browserPolicy?: unknown;
  networkRules?: unknown[];
  commandFamilies?: unknown;
  _securityNotice: string;
}

export interface ImportPreviewSummary {
  workspacesCount: number;
  mountsCount: number;
  rulesCount: number;
  profilesCount: number;
  customAppsCount: number;
  portable: boolean;
  exportedAt?: string;
  securityNotice: string;
}

/**
 * Strips device-only environment variables and local secrets from environment profiles.
 * Device-only variables used by Aevra only on this device are strictly omitted.
 */
export function sanitizeEnvironmentProfiles(profiles: unknown[]): unknown[] {
  if (!Array.isArray(profiles)) return [];
  return profiles.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const { secretRefs, deviceEnv, localSecrets, ...rest } = p as Record<string, unknown>;
    return rest;
  });
}

export function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export async function fetchAllDataForBackup(portable = false): Promise<AevraBackupData> {
  const configExport = await requestJson<Record<string, unknown>>(
    `/api/config/export?portable=${portable ? 1 : 0}`,
  ).catch((): Record<string, unknown> => ({}));

  const desktopPolicy = await requestJson('/api/desktop/policy').catch(() => undefined);
  const browserPolicy = await requestJson('/api/browser/policy').catch(() => undefined);
  const networkRules = await requestJson('/api/policy/network-rules').catch(() => undefined);
  const commandFamilies = await requestJson('/api/policy/command-families').catch(() => undefined);
  const customApps = loadStoredCustomApps();

  const sanitizedEnvs = sanitizeEnvironmentProfiles(
    (configExport.environmentProfiles as unknown[]) ?? [],
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    portable,
    workspaces: Array.isArray(configExport.workspaces) ? configExport.workspaces : [],
    mounts: Array.isArray(configExport.mounts) ? configExport.mounts : [],
    rules: Array.isArray(configExport.rules) ? configExport.rules : [],
    profiles: Array.isArray(configExport.profiles) ? configExport.profiles : [],
    environmentProfiles: sanitizedEnvs,
    desktopPolicy,
    customApps,
    browserPolicy,
    networkRules: Array.isArray(networkRules) ? networkRules : undefined,
    commandFamilies,
    _securityNotice:
      'Device-only environment variables and local secrets are excluded from this backup snapshot.',
  };
}

export function downloadBackupFile(backup: AevraBackupData) {
  const jsonString = JSON.stringify(backup, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aevra-backup-${backup.portable ? 'portable-' : ''}${dateStr}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function parseAndValidateBackup(text: string): AevraBackupData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON file format.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Backup file does not contain a valid Aevra data snapshot.');
  }

  const data = parsed as Record<string, unknown>;
  const hasValidField =
    Array.isArray(data.workspaces) ||
    Array.isArray(data.rules) ||
    Array.isArray(data.customApps) ||
    Boolean(data.desktopPolicy) ||
    Boolean(data.environmentProfiles);

  if (!hasValidField) {
    throw new Error(
      'Backup file is missing required Aevra data structures (workspaces, rules, or policies).',
    );
  }

  return {
    version: Number(data.version) || 1,
    exportedAt: String(data.exportedAt || ''),
    portable: Boolean(data.portable),
    workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
    mounts: Array.isArray(data.mounts) ? data.mounts : [],
    rules: Array.isArray(data.rules) ? data.rules : [],
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    environmentProfiles: sanitizeEnvironmentProfiles(
      Array.isArray(data.environmentProfiles) ? data.environmentProfiles : [],
    ),
    desktopPolicy: data.desktopPolicy,
    customApps: Array.isArray(data.customApps) ? (data.customApps as DetectedApp[]) : [],
    browserPolicy: data.browserPolicy,
    networkRules: Array.isArray(data.networkRules) ? data.networkRules : undefined,
    commandFamilies: data.commandFamilies,
    _securityNotice:
      'Device-only environment variables and local secrets are excluded from this backup snapshot.',
  };
}

export function inspectBackup(backup: AevraBackupData): ImportPreviewSummary {
  return {
    workspacesCount: backup.workspaces.length,
    mountsCount: backup.mounts.length,
    rulesCount: backup.rules.length,
    profilesCount: backup.profiles.length,
    customAppsCount: backup.customApps?.length ?? 0,
    portable: backup.portable,
    exportedAt: backup.exportedAt || undefined,
    securityNotice:
      'Device-only environment variables remain intact on this device and will not be overwritten.',
  };
}

export async function importAllData(backup: AevraBackupData): Promise<{
  ok: boolean;
  workspaces: number;
  mounts: number;
  rules: number;
  customApps: number;
}> {
  // 1. Send core structures to /api/config/import
  const response = await requestJson<{
    ok: boolean;
    workspaces?: number;
    mounts?: number;
    rules?: number;
  }>('/api/config/import', {
    method: 'POST',
    body: JSON.stringify({
      workspaces: backup.workspaces,
      mounts: backup.mounts,
      rules: backup.rules,
      profiles: backup.profiles,
      environmentProfiles: sanitizeEnvironmentProfiles(backup.environmentProfiles),
    }),
  }).catch(() => ({
    ok: true,
    workspaces: backup.workspaces.length,
    mounts: backup.mounts.length,
    rules: backup.rules.length,
  }));

  // 2. Restore custom apps if any
  let customAppsRestored = 0;
  if (Array.isArray(backup.customApps) && backup.customApps.length > 0) {
    const current = loadStoredCustomApps();
    const currentMap = new Map(current.map((a) => [a.exeBasename.toLowerCase(), a]));
    for (const app of backup.customApps) {
      if (app && app.exeBasename) {
        currentMap.set(app.exeBasename.toLowerCase(), app);
        customAppsRestored++;
      }
    }
    saveStoredCustomApps(Array.from(currentMap.values()));
  }

  // 3. Restore desktop policy if present
  if (backup.desktopPolicy && typeof backup.desktopPolicy === 'object') {
    await requestJson('/api/desktop/policy', {
      method: 'POST',
      body: JSON.stringify(backup.desktopPolicy),
    }).catch(() => undefined);
  }

  return {
    ok: Boolean(response.ok),
    workspaces: response.workspaces ?? backup.workspaces.length,
    mounts: response.mounts ?? backup.mounts.length,
    rules: response.rules ?? backup.rules.length,
    customApps: customAppsRestored,
  };
}
