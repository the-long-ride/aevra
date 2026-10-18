import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { McpUpstreamRowActions } from './McpUpstreamRowActions';
import type { UpstreamSummary } from './McpUpstreamsSettings';

const row: UpstreamSummary = {
  id: 'u1',
  name: 'github',
  transport: 'http',
  config: { url: 'https://mcp.example.com/mcp' },
  auth: { kind: 'none' },
  risk: 'HIGH',
  enabled: true,
  state: 'active',
  toolCount: 1,
  resourceCount: 0,
  promptCount: 0,
  pendingCatalogDiff: null,
  advisory: [],
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
};

function mount(overrides: Partial<UpstreamSummary> = {}, busy = false) {
  const handlers = {
    onHints: vi.fn(),
    onToggle: vi.fn(),
    onTest: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  };
  render(<McpUpstreamRowActions row={{ ...row, ...overrides }} busy={busy} {...handlers} />);
  return handlers;
}

describe('McpUpstreamRowActions', () => {
  it('shows a switch that reflects enabled and toggles to the opposite value', () => {
    const { onToggle } = mount();
    const toggle = screen.getByRole('switch', { name: 'Enable github' });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('turns a disabled server on', () => {
    const { onToggle } = mount({ enabled: false });
    const toggle = screen.getByRole('switch', { name: 'Enable github' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('disables every control while busy', async () => {
    const { onToggle, onTest } = mount({}, true);
    const toggle = screen.getByRole('switch', { name: 'Enable github' });
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Test github' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit github' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove github' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Test github' }));
    expect(onTest).not.toHaveBeenCalled();
  });

  it('routes test, edit and remove clicks', () => {
    const { onTest, onEdit, onRemove } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Test github' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit github' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove github' }));
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('cannot test a disabled server', () => {
    const { onTest } = mount({ enabled: false });
    const button = screen.getByRole('button', { name: 'Test github' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onTest).not.toHaveBeenCalled();
  });

  it('has no Acknowledge button, even for a server that needs review', () => {
    mount({
      state: 'needs-review',
      pendingCatalogDiff: { added: ['tool:new_tool'], removed: [], changed: [] },
    });
    expect(screen.queryByRole('button', { name: /acknowledge/i })).toBeNull();
  });
});
