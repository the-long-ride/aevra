import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataPage } from './DataPage';
import * as dataService from './data-service';

const portableBackup = {
  version: 1,
  exportedAt: '2026-09-17T00:00:00.000Z',
  portable: true,
  workspaces: [],
  mounts: [],
  rules: [],
  profiles: [],
  environmentProfiles: [],
};

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

async function selectBackup(content: string, name = 'backup.json') {
  fireEvent.change(fileInput(), {
    target: { files: [new File([content], name, { type: 'application/json' })] },
  });
  expect(await screen.findByText(name)).toBeInTheDocument();
}

describe('DataPage failure paths', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the backup error message and re-enables the button', async () => {
    vi.spyOn(dataService, 'fetchAllDataForBackup').mockRejectedValue(new Error('Server offline'));
    render(<DataPage />);

    fireEvent.click(screen.getByRole('button', { name: /download backup/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Server offline');
    expect(screen.getByRole('button', { name: /download backup/i })).toBeEnabled();
  });

  it('stringifies non-Error backup failures and passes portable mode through', async () => {
    const fetchSpy = vi
      .spyOn(dataService, 'fetchAllDataForBackup')
      .mockRejectedValue('plain words');
    render(<DataPage />);

    fireEvent.click(screen.getByRole('switch', { name: /portable mode/i }));
    fireEvent.click(screen.getByRole('button', { name: /download backup/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('plain words');
    expect(fetchSpy).toHaveBeenCalledWith(true);
  });

  it('keeps the page unchanged when the file picker is dismissed', () => {
    render(<DataPage />);
    fireEvent.change(fileInput(), { target: { files: [] } });

    expect(screen.getByText('No file chosen')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stringifies non-Error read failures', async () => {
    vi.spyOn(dataService, 'readFileAsText').mockRejectedValue('unreadable file');
    render(<DataPage />);
    fireEvent.change(fileInput(), {
      target: { files: [new File(['x'], 'odd.json', { type: 'application/json' })] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('unreadable file');
    expect(screen.queryByText(/backup preview/i)).not.toBeInTheDocument();
  });

  it('labels portable backups and reports import errors of both shapes', async () => {
    const importSpy = vi
      .spyOn(dataService, 'importAllData')
      .mockRejectedValueOnce(new Error('Import rejected'))
      .mockRejectedValueOnce('import stalled');
    render(<DataPage />);
    await selectBackup(JSON.stringify(portableBackup));

    expect(await screen.findByText('Portable')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /confirm & import data/i });

    fireEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent('Import rejected');
    expect(screen.getByText(/backup preview/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm & import data/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('import stalled'));
    expect(importSpy).toHaveBeenCalledTimes(2);
  });

  it('hides the success toast after three seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(dataService, 'fetchAllDataForBackup').mockResolvedValue(portableBackup as any);
    vi.spyOn(dataService, 'downloadBackupFile').mockImplementation(() => {});
    render(<DataPage />);

    fireEvent.click(screen.getByRole('button', { name: /download backup/i }));
    expect(await screen.findByRole('status')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/backup file generated/i)).toBeInTheDocument();
  });
});
