import { describe, expect, it } from 'vitest';
import type { DetectedApp } from './DesktopControlSettings';
import { canonicalWindowsPath, migrateLocalCustomApps } from './custom-app-migration';

function app(displayName: string, executablePath: string): DetectedApp {
  return {
    displayName,
    version: null,
    executablePath,
    exeBasename: executablePath.split(/[\\/]/).at(-1) ?? executablePath,
  };
}

describe('custom app migration', () => {
  it('normalizes ordinary, extended-length, and UNC Windows paths', () => {
    expect(canonicalWindowsPath(' C:/Tools/App.EXE\\ ')).toBe('c:\\tools\\app.exe');
    expect(canonicalWindowsPath('\\\\?\\C:/Tools/App.EXE/')).toBe('c:\\tools\\app.exe');
    expect(canonicalWindowsPath('\\\\?\\UNC\\Server\\Share\\App.EXE')).toBe(
      '\\\\server\\share\\app.exe',
    );
  });

  it('removes only entries confirmed at the same executable path', async () => {
    const localApps = [
      app('confirmed', 'C:\\Tools\\Confirmed.exe'),
      app('wrong path', 'C:\\Tools\\Wrong.exe'),
      app('missing path', 'C:\\Tools\\Missing.exe'),
      app('rejected', 'C:\\Tools\\Rejected.exe'),
    ];

    const result = await migrateLocalCustomApps(localApps, async (entry) => {
      if (entry.displayName === 'confirmed')
        return { executablePath: '\\\\?\\c:/tools/confirmed.exe/' };
      if (entry.displayName === 'wrong path') return { executablePath: 'C:\\Elsewhere\\Wrong.exe' };
      if (entry.displayName === 'missing path') return { executablePath: null };
      throw new Error('Core unavailable');
    });

    expect(result).toEqual({
      imported: 1,
      failed: 3,
      remaining: localApps.slice(1),
    });
  });
});
