import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DataPage } from './DataPage';
import * as dataService from './data-service';

describe('DataPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders heading and both backup and import panels', () => {
    render(<DataPage />);
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Backup all data' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Import data' })).toBeInTheDocument();
    expect(
      screen.getByText(/Notice: Device-only environment variables and local secrets are excluded/i),
    ).toBeInTheDocument();
  });

  it('triggers backup download and displays toast on click', async () => {
    const fetchSpy = vi.spyOn(dataService, 'fetchAllDataForBackup').mockResolvedValue({
      version: 1,
      exportedAt: '2026-09-17T00:00:00.000Z',
      portable: false,
      workspaces: [{ id: 'ws-1', name: 'Primary' }],
      mounts: [],
      rules: [{ id: 'rule-1' }],
      profiles: [],
      environmentProfiles: [],
      _securityNotice: 'Device-only environment variables excluded',
    });
    const downloadSpy = vi.spyOn(dataService, 'downloadBackupFile').mockImplementation(() => {});

    render(<DataPage />);
    const backupBtn = screen.getByRole('button', { name: /download backup/i });
    fireEvent.click(backupBtn);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
      expect(downloadSpy).toHaveBeenCalled();
    });

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('// Backup downloaded successfully.');
  });

  it('shows error if an invalid JSON file is selected', async () => {
    render(<DataPage />);
    const file = new File(['invalid json string {['], 'broken.json', {
      type: 'application/json',
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/invalid json/i);
    });
  });

  it('displays preview and allows completing import with toast', async () => {
    const validBackup = {
      version: 1,
      exportedAt: '2026-09-17T00:00:00.000Z',
      portable: false,
      workspaces: [{ id: 'ws-1', name: 'Primary' }],
      mounts: [{ id: 'm-1' }],
      rules: [{ id: 'r-1' }, { id: 'r-2' }],
      profiles: [{ id: 'p-1' }],
      customApps: [
        {
          displayName: 'Tool',
          version: '1.0',
          executablePath: 'C:\\tool.exe',
          exeBasename: 'tool.exe',
        },
      ],
      environmentProfiles: [],
    };

    const importSpy = vi.spyOn(dataService, 'importAllData').mockResolvedValue({
      ok: true,
      workspaces: 1,
      mounts: 1,
      rules: 2,
      customApps: 1,
    });

    render(<DataPage />);
    const file = new File([JSON.stringify(validBackup)], 'valid-backup.json', {
      type: 'application/json',
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/backup preview/i)).toBeInTheDocument();
    expect(screen.getByText('Workspaces:')).toBeInTheDocument();
    expect(screen.getByText('Custom apps:')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /confirm & import data/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalled();
    });

    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent('// Data imported successfully.');
    expect(screen.getByText(/import complete/i)).toBeInTheDocument();
  });

  it('canceling preview clears selected file', async () => {
    const validBackup = {
      version: 1,
      workspaces: [{ id: 'ws-1', name: 'Primary' }],
      mounts: [],
      rules: [],
      profiles: [],
      environmentProfiles: [],
    };

    render(<DataPage />);
    const file = new File([JSON.stringify(validBackup)], 'sample.json', {
      type: 'application/json',
    });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/backup preview/i)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.queryByText(/backup preview/i)).not.toBeInTheDocument();
  });
});
