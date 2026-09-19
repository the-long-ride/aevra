import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
const mockLoadSettings = vi.fn();

vi.mock('./settings-service', () => ({
  loadSettings: () => mockLoadSettings(),
  patchJson: vi.fn(),
  postJson: vi.fn(),
  deleteResource: vi.fn(),
}));
vi.mock('./McpUpstreamsSettings', () => ({
  McpUpstreamsSettings: () => <div data-testid="mcp-upstreams-panel" />,
}));
import { DialogProvider } from '../../components/Dialog';
import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
  it('mounts the MCP upstream panel', async () => {
    mockLoadSettings.mockResolvedValueOnce({
      exposure: {},
      power: {},
      execution: {},
      yolo: { mode: 'off' },
      browser: {},
      adminSettings: {},
      commandFamilies: [],
      networkRules: [],
      workspaces: [],
      profiles: [],
      secretRefs: [],
      hooks: [],
    });
    render(
      <DialogProvider>
        <SettingsPage />
      </DialogProvider>,
    );
    expect(await screen.findByTestId('mcp-upstreams-panel')).toBeTruthy();
  });

  it('renders error state when loadSettings fails', async () => {
    mockLoadSettings.mockRejectedValueOnce(new Error('Failed to load settings data'));
    render(
      <DialogProvider>
        <SettingsPage />
      </DialogProvider>,
    );
    expect(await screen.findByText('Failed to load settings data')).toBeInTheDocument();
  });
});
