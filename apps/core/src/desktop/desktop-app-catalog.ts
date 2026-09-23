import { randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import type {
  DesktopAppCatalogResult,
  DesktopCatalogApp,
} from '../../../../packages/protocol/src/desktop.js';
import { DesktopAppCatalogRepository } from '../../../../packages/store/src/desktop-app-catalog.js';
import {
  basename,
  canonicalExecutablePath,
} from '../../../../packages/security/src/window-gate.js';
import { scanDesktopApps } from '../../../../packages/desktop/src/app-catalog.js';
import type { DesktopAccessService } from './desktop-access-service.js';

interface DesktopAppCatalogDeps {
  repository: DesktopAppCatalogRepository;
  access: DesktopAccessService;
  scan?: () => Promise<DesktopAppCatalogResult>;
  audit?: { append(input: any): unknown };
}

function normalizeExecutablePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replaceAll('/', '\\');
  const canonical = canonicalExecutablePath(trimmed);
  if (!(/^[a-z]:\\/i.test(canonical) || /^\\\\[^\\]+\\[^\\]+\\/.test(canonical))) return undefined;
  if (!canonical.toLowerCase().endsWith('.exe')) return undefined;
  return trimmed;
}

function appBasename(path: string): string {
  return basename(path);
}

export class DesktopAppCatalogService {
  constructor(private readonly deps: DesktopAppCatalogDeps) {}

  async list(): Promise<DesktopAppCatalogResult> {
    const detected = await (this.deps.scan ?? scanDesktopApps)();
    const custom = this.deps.repository.listCustom();
    const apps = new Map<string, DesktopCatalogApp>();
    for (const app of detected.apps) {
      const key = app.executablePath ? canonicalExecutablePath(app.executablePath) : '';
      if (key)
        apps.set(key, { ...app, sources: [...app.sources], isCustom: false } as DesktopCatalogApp);
      else apps.set(`unresolved:${apps.size}`, { ...app, isCustom: false } as DesktopCatalogApp);
    }
    for (const entry of custom) {
      const existing = apps.get(entry.pathKey);
      apps.set(entry.pathKey, {
        ...(existing ?? {
          executablePath: entry.executablePath,
          exeBasename: appBasename(entry.executablePath),
          sources: [],
          grantable: true,
        }),
        displayName: entry.displayName,
        version: entry.version,
        executablePath: entry.executablePath,
        exeBasename: appBasename(entry.executablePath),
        sources: [...new Set([...(existing?.sources ?? []), 'custom'])],
        grantable: true,
        isCustom: true,
        customAppId: entry.id,
      } as DesktopCatalogApp);
    }

    const grants = this.deps.access.listGrants().filter((grant) => !grant.sessionId);
    const grantsByPath = new Map<string, typeof grants>();
    for (const grant of grants) {
      const key = canonicalExecutablePath(grant.executablePath);
      grantsByPath.set(key, [...(grantsByPath.get(key) ?? []), grant]);
    }
    const catalogApps = [...apps.entries()]
      .map(([key, app]) => {
        const grant = (grantsByPath.get(key) ?? [])[0];
        return {
          ...app,
          ...(grant ? { isGranted: true, grantId: grant.id } : { isGranted: false }),
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
    return { apps: catalogApps, warnings: detected.warnings };
  }

  async saveCustom(input: {
    id?: unknown;
    executablePath: unknown;
    displayName?: unknown;
    version?: unknown;
  }) {
    const executable = normalizeExecutablePath(input.executablePath);
    if (!executable)
      throw Object.assign(new Error('An absolute Windows .exe path is required'), {
        code: 'INVALID_REQUEST',
      });
    let resolved: string;
    try {
      resolved = await realpath(executable);
      if (!(await stat(resolved)).isFile()) throw new Error('not a file');
    } catch {
      throw Object.assign(
        new Error('The executable path does not point to an existing file on this device'),
        { code: 'INVALID_REQUEST' },
      );
    }
    if (!resolved.toLowerCase().endsWith('.exe')) {
      throw Object.assign(new Error('The selected file must have an .exe extension'), {
        code: 'INVALID_REQUEST',
      });
    }
    const pathKey = canonicalExecutablePath(resolved);
    const fallbackName = appBasename(resolved).replace(/\.exe$/i, '');
    const displayName =
      typeof input.displayName === 'string' && input.displayName.trim()
        ? input.displayName.trim().slice(0, 120)
        : fallbackName;
    const version =
      typeof input.version === 'string' && input.version.trim()
        ? input.version.trim().slice(0, 40)
        : null;
    if (input.id !== undefined && typeof input.id !== 'string') {
      throw Object.assign(new Error('Custom app id must be a string'), { code: 'INVALID_REQUEST' });
    }
    const now = new Date().toISOString();
    const saved = this.deps.repository.saveCustom({
      ...(typeof input.id === 'string' ? { id: input.id } : { id: randomUUID() }),
      pathKey,
      executablePath: resolved,
      displayName,
      version,
      createdAt: now,
      updatedAt: now,
    });
    this.deps.access.renameGrantsForPath(resolved, displayName);
    this.deps.audit?.append({
      actor: 'admin',
      tool: 'desktop_custom_app_save',
      operation: 'desktop:catalog:save',
      target: displayName,
      risk: 'MEDIUM',
      result: 'SAVED',
      redactionCount: 0,
      class: 'security',
    });
    return saved;
  }

  deleteCustom(id: string, decidedBy = 'admin') {
    const removed = this.deps.repository.deleteCustom(id);
    if (!removed) throw Object.assign(new Error('Custom app not found'), { code: 'NOT_FOUND' });
    this.deps.audit?.append({
      actor: decidedBy,
      tool: 'desktop_custom_app_delete',
      operation: 'desktop:catalog:delete',
      target: removed.displayName,
      risk: 'MEDIUM',
      result: 'DELETED',
      redactionCount: 0,
      class: 'security',
    });
    return removed;
  }

  async grant(input: { executablePath: unknown; displayName?: unknown }, decidedBy = 'admin') {
    const executable = normalizeExecutablePath(input.executablePath);
    if (!executable)
      throw Object.assign(new Error('An absolute Windows .exe path is required'), {
        code: 'INVALID_REQUEST',
      });
    let resolved: string;
    try {
      resolved = await realpath(executable);
      if (!(await stat(resolved)).isFile()) throw new Error('not a file');
    } catch {
      throw Object.assign(
        new Error('The executable path does not point to an existing file on this device'),
        { code: 'INVALID_REQUEST' },
      );
    }
    if (appBasename(resolved).toLowerCase() === 'msedgewebview2.exe') {
      throw Object.assign(
        new Error(
          'WebView2 is a shared runtime; use the explicitly warned broad process rule or request access to a verified host app',
        ),
        { code: 'SHARED_RUNTIME_REQUIRES_EXPLICIT_POLICY' },
      );
    }
    const key = canonicalExecutablePath(resolved);
    const custom = this.deps.repository.findCustomByPath(key);
    if (!custom) {
      const detected = await (this.deps.scan ?? scanDesktopApps)();
      const known = detected.apps.some(
        (app) =>
          app.executablePath &&
          canonicalExecutablePath(app.executablePath) === key &&
          app.grantable,
      );
      if (!known)
        throw Object.assign(
          new Error('The executable is not present in the verified app catalog'),
          { code: 'APP_NOT_IN_CATALOG' },
        );
    }
    const name =
      typeof input.displayName === 'string' && input.displayName.trim()
        ? input.displayName.trim().slice(0, 120)
        : (custom?.displayName ?? appBasename(resolved).replace(/\.exe$/i, ''));
    return this.deps.access.grantExplicitApp(
      { executablePath: resolved, displayName: name },
      decidedBy,
    );
  }
}
