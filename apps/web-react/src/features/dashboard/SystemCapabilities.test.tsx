import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { SystemCapabilitySnapshot } from '@aevra/admin-contracts';
import { SystemCapabilities } from './SystemCapabilities';

const system: SystemCapabilitySnapshot = {
  scope: 'host',
  detectedAt: '2026-08-27T12:00:00.000Z',
  os: {
    platform: 'windows',
    platformDetail: 'Windows 11',
    arch: 'x64',
    recommendedShell: 'pwsh',
    availableShells: [
      { id: 'pwsh', label: 'PowerShell 7', version: '7.5.2' },
      { id: 'cmd', label: 'Command Prompt' },
      { id: 'wsl', label: 'WSL' },
    ],
  },
  toolchains: [
    {
      id: 'git',
      label: 'Git',
      category: 'source-control',
      available: true,
      executable: 'git',
      version: '2.51.0',
    },
    {
      id: 'node',
      label: 'Node.js',
      category: 'javascript',
      available: true,
      executable: 'node',
      version: '24.7.0',
    },
    {
      id: 'go',
      label: 'Go',
      category: 'go',
      available: false,
    },
  ],
};

test('renders OS shell and curated tool availability read-only', () => {
  render(<SystemCapabilities system={system} />);

  expect(screen.getByText('Windows 11 · x64')).toBeInTheDocument();
  expect(screen.getByText('PowerShell 7')).toBeInTheDocument();
  expect(screen.getByText('Node.js')).toBeInTheDocument();
  expect(screen.getByText('24.7.0')).toBeInTheDocument();
  expect(screen.getAllByText('Go').length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText('Not detected').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Shells')).toBeInTheDocument();
  expect(screen.getByText('WSL')).toBeInTheDocument();

  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('combobox')).toBeNull();
});

test('renders missing shell and version data without inventing values', () => {
  render(
    <SystemCapabilities
      system={{
        ...system,
        os: { ...system.os, recommendedShell: null, availableShells: [] },
        toolchains: [{ ...system.toolchains[0]!, version: undefined }],
      }}
    />,
  );

  expect(screen.getAllByText('Not detected').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Version unavailable')).toBeInTheDocument();
});
