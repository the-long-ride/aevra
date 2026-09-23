import type { DesktopAppCatalogResult, DesktopCatalogApp } from '../../protocol/src/desktop.js';
import { detectPackagedApps } from './packaged-apps.js';
import { detectRunningApps } from './running-apps.js';
import { detectStartMenuApps } from './start-menu-apps.js';
import { canonicalAppPath } from './windows-app-scan.js';
import { detectRegistryCatalogApps } from './installed-apps.js';

type AppSourceReader = {
  name: string;
  read: () => Promise<{ apps: DesktopCatalogApp[]; warnings: string[] }>;
};

const APP_SOURCES: AppSourceReader[] = [
  { name: 'Registry', read: detectRegistryCatalogApps },
  { name: 'Start Menu', read: detectStartMenuApps },
  { name: 'Running app', read: detectRunningApps },
  { name: 'Packaged app', read: detectPackagedApps },
];

/** Merges only rows with the same canonical executable path. Basenames are labels, never identities. */
function mergeAppSources(rows: DesktopCatalogApp[]): DesktopCatalogApp[] {
  const merged = new Map<string, DesktopCatalogApp>();
  rows.forEach((row, index) => {
    const identity = row.executablePath
      ? `path:${canonicalAppPath(row.executablePath)}`
      : `unresolved:${index}`;
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, { ...row, sources: [...new Set(row.sources)] });
      return;
    }
    existing.sources = [...new Set([...existing.sources, ...row.sources])];
    if (!existing.version && row.version) existing.version = row.version;
  });

  return [...merged.values()].sort((a, b) => {
    const byName = a.displayName.localeCompare(b.displayName);
    if (byName !== 0) return byName;
    return (a.executablePath ?? '').localeCompare(b.executablePath ?? '');
  });
}

export async function scanDesktopApps(): Promise<DesktopAppCatalogResult> {
  if (process.platform !== 'win32') {
    return { apps: [], warnings: ['Windows app discovery is unavailable on this host'] };
  }

  const results = await Promise.allSettled(APP_SOURCES.map((source) => source.read()));
  const apps: DesktopCatalogApp[] = [];
  const warnings: string[] = [];
  results.forEach((result, index) => {
    const source = APP_SOURCES[index]!;
    if (result.status === 'rejected') {
      warnings.push(`${source.name} discovery failed; other app sources remain available`);
      return;
    }
    apps.push(...result.value.apps);
    warnings.push(...result.value.warnings);
  });

  return {
    apps: mergeAppSources(apps),
    warnings: [...new Set(warnings)],
  };
}
