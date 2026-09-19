import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../../services/api-client';
import * as desktopSettings from '../settings/DesktopControlSettings';
import {
  downloadBackupFile,
  fetchAllDataForBackup,
  readFileAsText,
  sanitizeEnvironmentProfiles,
  type AevraBackupData,
} from './data-service';

describe('data-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('sanitizeEnvironmentProfiles', () => {
    it('returns empty array when input is not an array', () => {
      expect(sanitizeEnvironmentProfiles(null as unknown as unknown[])).toEqual([]);
      expect(sanitizeEnvironmentProfiles(undefined as unknown as unknown[])).toEqual([]);
      expect(sanitizeEnvironmentProfiles('not-array' as unknown as unknown[])).toEqual([]);
    });

    it('passes through non-object items', () => {
      expect(sanitizeEnvironmentProfiles([1, 'string', null])).toEqual([1, 'string', null]);
    });

    it('strips secretRefs, deviceEnv, and localSecrets from environment profile objects', () => {
      const input = [
        {
          id: 'env-1',
          name: 'Prod',
          secretRefs: { key: 'ref' },
          deviceEnv: { token: 'secret' },
          localSecrets: { key: 'val' },
          allowedTools: ['git'],
        },
      ];
      const result = sanitizeEnvironmentProfiles(input);
      expect(result).toEqual([
        {
          id: 'env-1',
          name: 'Prod',
          allowedTools: ['git'],
        },
      ]);
      expect(result[0]).not.toHaveProperty('secretRefs');
      expect(result[0]).not.toHaveProperty('deviceEnv');
      expect(result[0]).not.toHaveProperty('localSecrets');
    });
  });

  describe('readFileAsText', () => {
    it('uses file.text() when available', async () => {
      const file = new File(['hello world'], 'test.txt', { type: 'text/plain' });
      const text = await readFileAsText(file);
      expect(text).toBe('hello world');
    });

    it('falls back to FileReader if file.text is not a function', async () => {
      const fakeFile = {
        name: 'test.txt',
      } as unknown as File;

      class MockFileReader {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        result: string | null = null;
        readAsText(_f: File) {
          this.result = 'mock content';
          this.onload?.();
        }
      }
      vi.stubGlobal('FileReader', MockFileReader);

      const res = await readFileAsText(fakeFile);
      expect(res).toBe('mock content');
    });

    it('rejects on FileReader error', async () => {
      const fakeFile = {
        name: 'test.txt',
      } as unknown as File;

      class MockFileReaderError {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        error = new Error('Disk read failed');
        readAsText(_f: File) {
          this.onerror?.();
        }
      }
      vi.stubGlobal('FileReader', MockFileReaderError);

      await expect(readFileAsText(fakeFile)).rejects.toThrow('Disk read failed');
    });
  });

  describe('fetchAllDataForBackup', () => {
    it('fetches all data endpoints successfully', async () => {
      const requestJsonSpy = vi
        .spyOn(apiClient, 'requestJson')
        .mockImplementation((path: string) => {
          if (path.includes('/api/config/export')) {
            return Promise.resolve({
              workspaces: [{ id: 'ws-1' }],
              mounts: [{ id: 'm-1' }],
              rules: [{ id: 'r-1' }],
              profiles: [{ id: 'p-1' }],
              environmentProfiles: [{ id: 'env-1', deviceEnv: { x: '1' } }],
            });
          }
          if (path === '/api/desktop/policy') return Promise.resolve({ allowedApps: [] });
          if (path === '/api/browser/policy') return Promise.resolve({ allowedOrigins: ['*'] });
          if (path === '/api/policy/network-rules') return Promise.resolve([{ id: 'nr-1' }]);
          if (path === '/api/policy/command-families') return Promise.resolve({ allowed: ['git'] });
          return Promise.reject(new Error('Unknown path'));
        });

      vi.spyOn(desktopSettings, 'loadStoredCustomApps').mockReturnValue([
        {
          displayName: 'Custom App',
          version: '1.0',
          exeBasename: 'app.exe',
          executablePath: 'C:\\app.exe',
        },
      ]);

      const data = await fetchAllDataForBackup(true);
      expect(data.portable).toBe(true);
      expect(data.workspaces).toHaveLength(1);
      expect(data.mounts).toHaveLength(1);
      expect(data.rules).toHaveLength(1);
      expect(data.profiles).toHaveLength(1);
      expect(data.environmentProfiles).toHaveLength(1);
      expect(data.environmentProfiles[0]).not.toHaveProperty('deviceEnv');
      expect(data.customApps).toHaveLength(1);
      expect(data.desktopPolicy).toBeDefined();
      expect(data.browserPolicy).toBeDefined();
      expect(data.networkRules).toHaveLength(1);
      expect(data.commandFamilies).toBeDefined();
      expect(requestJsonSpy).toHaveBeenCalledWith('/api/config/export?portable=1');
    });

    it('gracefully falls back when endpoints fail', async () => {
      vi.spyOn(apiClient, 'requestJson').mockRejectedValue(new Error('Network error'));
      vi.spyOn(desktopSettings, 'loadStoredCustomApps').mockReturnValue([]);

      const data = await fetchAllDataForBackup(false);
      expect(data.portable).toBe(false);
      expect(data.workspaces).toEqual([]);
      expect(data.mounts).toEqual([]);
      expect(data.rules).toEqual([]);
      expect(data.profiles).toEqual([]);
      expect(data.environmentProfiles).toEqual([]);
      expect(data.desktopPolicy).toBeUndefined();
      expect(data.browserPolicy).toBeUndefined();
      expect(data.networkRules).toBeUndefined();
      expect(data.commandFamilies).toBeUndefined();
    });
  });

  describe('downloadBackupFile', () => {
    it('creates object URL and triggers anchor click for standard and portable backups', () => {
      const createObjectURLMock = vi.fn().mockReturnValue('blob:http://localhost/test');
      const revokeObjectURLMock = vi.fn();
      vi.stubGlobal('URL', {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      });

      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');

      const mockData: AevraBackupData = {
        version: 1,
        exportedAt: '2026-09-19T10:00:00.000Z',
        portable: false,
        workspaces: [],
        mounts: [],
        rules: [],
        profiles: [],
        environmentProfiles: [],
        _securityNotice: 'notice',
      };

      downloadBackupFile(mockData);
      expect(createObjectURLMock).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalled();

      downloadBackupFile({ ...mockData, portable: true });
      expect(createObjectURLMock).toHaveBeenCalledTimes(2);
    });
  });
});
