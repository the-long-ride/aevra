import type { DetectedApp } from './DesktopControlSettings';

export interface CustomAppMigrationResult {
  imported: number;
  remaining: DetectedApp[];
  failed: number;
}

export function canonicalWindowsPath(value: string): string {
  let normalized = value.trim().replaceAll('/', '\\');
  if (/^\\\\\?\\UNC\\/i.test(normalized)) normalized = `\\\\${normalized.slice(8)}`;
  else if (/^\\\\\?\\/i.test(normalized)) normalized = normalized.slice(4);
  return normalized.replace(/\\+$/, '').toLowerCase();
}

/** Remove each browser-local row only after the Core API confirms its write. */
export async function migrateLocalCustomApps(
  local: DetectedApp[],
  save: (app: DetectedApp) => Promise<unknown>,
): Promise<CustomAppMigrationResult> {
  let imported = 0;
  let failed = 0;
  const remaining: DetectedApp[] = [];
  for (const app of local) {
    try {
      const saved = (await save(app)) as { executablePath?: unknown } | null;
      if (
        !saved ||
        typeof saved.executablePath !== 'string' ||
        canonicalWindowsPath(saved.executablePath) !== canonicalWindowsPath(app.executablePath)
      ) {
        throw new Error('Core did not confirm the same executable path');
      }
      imported += 1;
    } catch {
      failed += 1;
      remaining.push(app);
    }
  }
  return { imported, remaining, failed };
}
