import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../../services/api-client';
import * as desktopSettings from '../settings/DesktopControlSettings';
import {
  importAllData,
  inspectBackup,
  parseAndValidateBackup,
  type AevraBackupData,
} from './data-service';

describe('data-service import and inspect', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseAndValidateBackup', () => {
    it('throws error for invalid JSON format', () => {
      expect(() => parseAndValidateBackup('invalid { json')).toThrow('Invalid JSON file format.');
    });

    it('throws error for non-object JSON', () => {
      expect(() => parseAndValidateBackup('"just string"')).toThrow(
        'Backup file does not contain a valid Aevra data snapshot.',
      );
      expect(() => parseAndValidateBackup('null')).toThrow(
        'Backup file does not contain a valid Aevra data snapshot.',
      );
    });

    it('throws error when no recognized data structures exist', () => {
      expect(() => parseAndValidateBackup('{}')).toThrow(
        'Backup file is missing required Aevra data structures (workspaces, rules, or policies).',
      );
    });

    it('successfully parses valid backup and sets defaults for missing fields', () => {
      const json = JSON.stringify({
        workspaces: [{ id: 'ws-1' }],
        customApps: [{ exeBasename: 'tool.exe' }],
      });
      const result = parseAndValidateBackup(json);
      expect(result.version).toBe(1);
      expect(result.portable).toBe(false);
      expect(result.workspaces).toHaveLength(1);
      expect(result.mounts).toEqual([]);
      expect(result.rules).toEqual([]);
      expect(result.customApps).toHaveLength(1);
    });
  });

  describe('inspectBackup', () => {
    it('returns preview counts and summary', () => {
      const backup: AevraBackupData = {
        version: 1,
        exportedAt: '2026-09-19T10:00:00.000Z',
        portable: true,
        workspaces: [{ id: '1' }],
        mounts: [{ id: '1' }, { id: '2' }],
        rules: [],
        profiles: [{ id: '1' }],
        environmentProfiles: [],
        customApps: [
          {
            displayName: 'App',
            version: '1.0',
            exeBasename: 'app.exe',
            executablePath: 'C:\\app.exe',
          },
        ],
        _securityNotice: 'notice',
      };
      const summary = inspectBackup(backup);
      expect(summary.workspacesCount).toBe(1);
      expect(summary.mountsCount).toBe(2);
      expect(summary.rulesCount).toBe(0);
      expect(summary.profilesCount).toBe(1);
      expect(summary.customAppsCount).toBe(1);
      expect(summary.portable).toBe(true);
      expect(summary.exportedAt).toBe('2026-09-19T10:00:00.000Z');
    });

    it('handles backup with no customApps or exportedAt', () => {
      const backup: AevraBackupData = {
        version: 1,
        exportedAt: '',
        portable: false,
        workspaces: [],
        mounts: [],
        rules: [],
        profiles: [],
        environmentProfiles: [],
        _securityNotice: 'notice',
      };
      const summary = inspectBackup(backup);
      expect(summary.customAppsCount).toBe(0);
      expect(summary.exportedAt).toBeUndefined();
    });
  });

  describe('importAllData', () => {
    it('posts config data, restores custom apps and desktop policy', async () => {
      const requestJsonSpy = vi.spyOn(apiClient, 'requestJson').mockResolvedValue({
        ok: true,
        workspaces: 2,
        mounts: 1,
        rules: 3,
      });

      const loadSpy = vi.spyOn(desktopSettings, 'loadStoredCustomApps').mockReturnValue([]);
      const saveSpy = vi.spyOn(desktopSettings, 'saveStoredCustomApps').mockReturnValue();

      const backup: AevraBackupData = {
        version: 1,
        exportedAt: '',
        portable: false,
        workspaces: [{ id: '1' }, { id: '2' }],
        mounts: [{ id: '1' }],
        rules: [{ id: '1' }, { id: '2' }, { id: '3' }],
        profiles: [],
        environmentProfiles: [],
        customApps: [
          {
            displayName: 'Notepad',
            version: '1.0',
            exeBasename: 'notepad.exe',
            executablePath: 'notepad.exe',
          },
        ],
        desktopPolicy: { allowedApps: ['notepad.exe'] },
        _securityNotice: 'notice',
      };

      const result = await importAllData(backup);
      expect(result.ok).toBe(true);
      expect(result.workspaces).toBe(2);
      expect(result.mounts).toBe(1);
      expect(result.rules).toBe(3);
      expect(result.customApps).toBe(1);
      expect(loadSpy).toHaveBeenCalled();
      expect(saveSpy).toHaveBeenCalled();
      expect(requestJsonSpy).toHaveBeenCalledWith('/api/config/import', expect.any(Object));
      expect(requestJsonSpy).toHaveBeenCalledWith('/api/desktop/policy', expect.any(Object));
    });

    it('falls back safely when /api/config/import or /api/desktop/policy reject', async () => {
      vi.spyOn(apiClient, 'requestJson').mockRejectedValue(new Error('Server offline'));

      const backup: AevraBackupData = {
        version: 1,
        exportedAt: '',
        portable: false,
        workspaces: [{ id: '1' }],
        mounts: [{ id: '1' }],
        rules: [{ id: '1' }],
        profiles: [],
        environmentProfiles: [],
        desktopPolicy: { allowedApps: [] },
        _securityNotice: 'notice',
      };

      const result = await importAllData(backup);
      expect(result.ok).toBe(true);
      expect(result.workspaces).toBe(1);
      expect(result.mounts).toBe(1);
      expect(result.rules).toBe(1);
      expect(result.customApps).toBe(0);
    });
  });
});
