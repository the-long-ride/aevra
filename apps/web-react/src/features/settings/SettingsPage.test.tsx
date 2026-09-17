import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('./settings-service', () => ({
  loadSettings: () =>
    Promise.resolve({
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
    }),
  patchJson: vi.fn(),
  postJson: vi.fn(),
  deleteResource: vi.fn(),
}));
vi.mock('./McpUpstreamsSettings', () => ({
  McpUpstreamsSettings: () => <div data-testid="mcp-upstreams-panel" />,
}));
import { SettingsPage } from './SettingsPage';
describe('SettingsPage', () => {
  it('mounts the MCP upstream panel', async () => {
    render(<SettingsPage />);
    expect(await screen.findByTestId('mcp-upstreams-panel')).toBeTruthy();
  });
});
