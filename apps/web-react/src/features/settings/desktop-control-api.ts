import { requestJson } from '../../services/api-client';
import type {
  DesktopAppCatalogResponse,
  DesktopAppGrantRow,
  DesktopPolicySnapshot,
  DetectedApp,
} from './desktop-control-types';

export const CUSTOM_APPS_STORAGE_KEY = 'aevra.custom_desktop_apps';

export function loadStoredCustomApps(): DetectedApp[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_APPS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DetectedApp[]) : [];
  } catch {
    return [];
  }
}

export function saveStoredCustomApps(apps: DetectedApp[]): void {
  try {
    window.localStorage.setItem(CUSTOM_APPS_STORAGE_KEY, JSON.stringify(apps));
  } catch {
    // ignore
  }
}

export const loadDesktopPolicy = () => requestJson<DesktopPolicySnapshot>('/api/desktop/policy');

export const saveDesktopPolicy = (next: Partial<DesktopPolicySnapshot>) =>
  requestJson<DesktopPolicySnapshot>('/api/desktop/policy', {
    method: 'POST',
    body: JSON.stringify(next),
  });

export const loadDetectedApps = () => requestJson<DesktopAppCatalogResponse>('/api/desktop/apps');

export const saveCustomApp = (app: DetectedApp, id?: string) =>
  requestJson<{ app: DetectedApp }>('/api/desktop/custom-apps', {
    method: 'PUT',
    body: JSON.stringify({
      ...(id ? { id } : {}),
      executablePath: app.executablePath,
      displayName: app.displayName,
      version: app.version,
    }),
  });

export const deleteCustomApp = (id: string) =>
  requestJson<{ app: unknown }>(`/api/desktop/custom-apps/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const loadDesktopAppGrants = () =>
  requestJson<{ grants: DesktopAppGrantRow[] }>('/api/desktop/app-grants');

export const grantDesktopApp = (app: { executablePath: string; displayName: string }) =>
  requestJson<{ grant: DesktopAppGrantRow }>('/api/desktop/app-grants', {
    method: 'POST',
    body: JSON.stringify(app),
  });

export const revokeDesktopAppGrant = (id: string) =>
  requestJson<DesktopAppGrantRow>(`/api/desktop/app-grants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
