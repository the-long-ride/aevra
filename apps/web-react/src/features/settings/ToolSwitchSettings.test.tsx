import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ToolSwitchEntry } from '@aevra/admin-contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolSwitchSettings } from './ToolSwitchSettings';
import * as service from '../../services/tool-switch-service';

vi.mock('../../services/tool-switch-service', () => ({
  fetchToolSwitches: vi.fn(),
  saveToolSwitches: vi.fn(),
}));

function tool(over: Partial<ToolSwitchEntry> & { name: string }): ToolSwitchEntry {
  return {
    source: 'aevra',
    group: 'files',
    locked: false,
    enabled: true,
    available: true,
    description: '',
    ...over,
  };
}

const TOOLS: ToolSwitchEntry[] = [
  tool({ name: 'workspace_list', group: 'core', locked: true }),
  tool({ name: 'file_read_many' }),
  tool({ name: 'file_write_many' }),
  tool({ name: 'git_status', group: 'git' }),
  tool({ name: 'docs__search', source: 'docs', group: 'docs', available: false }),
  tool({ name: 'docs__fetch', source: 'docs', group: 'docs', available: false, enabled: false }),
];

beforeEach(() => {
  vi.mocked(service.fetchToolSwitches).mockResolvedValue({ tools: TOOLS });
  vi.mocked(service.saveToolSwitches).mockReset();
  vi.mocked(service.saveToolSwitches).mockResolvedValue({ tools: TOOLS });
});

async function renderPanel() {
  render(<ToolSwitchSettings />);
  await screen.findByRole('heading', { name: 'Tools' });
  await screen.findByText('Aevra: files');
}

describe('ToolSwitchSettings', () => {
  it('renders aevra groups then one group per upstream slug', async () => {
    await renderPanel();
    const titles = Array.from(document.querySelectorAll('.tool-switch-group-title')).map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(['Aevra: core', 'Aevra: files', 'Aevra: git', 'docs']);
    expect(screen.getByText(/pick up changes on reconnect/)).toBeInTheDocument();
  });

  it('shows locked rows checked and disabled with a title', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Aevra: core' }));
    const locked = screen.getByRole('switch', { name: 'workspace_list' });
    expect(locked).toBeChecked();
    expect(locked).toBeDisabled();
    expect(locked).toHaveAttribute('title', 'Always on: agents need this tool');
  });

  it('group switch toggles all unlocked rows', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Aevra: files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Aevra: git' }));
    const group = screen.getByRole('switch', { name: 'Aevra: files: all tools' });
    expect(group).toBeChecked();
    fireEvent.click(group);
    expect(screen.getByRole('switch', { name: 'file_read_many' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'file_write_many' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'git_status' })).toBeChecked();
    fireEvent.click(group);
    expect(screen.getByRole('switch', { name: 'file_read_many' })).toBeChecked();
  });

  it('collapses and expands a tool group on toggle click', async () => {
    await renderPanel();
    expect(screen.queryByRole('switch', { name: 'file_read_many' })).toBeNull();
    const expandBtn = screen.getByRole('button', { name: 'Expand Aevra: files' });
    fireEvent.click(expandBtn);
    expect(screen.getByRole('switch', { name: 'file_read_many' })).toBeInTheDocument();
    const collapseBtn = screen.getByRole('button', { name: 'Collapse Aevra: files' });
    fireEvent.click(collapseBtn);
    expect(screen.queryByRole('switch', { name: 'file_read_many' })).toBeNull();
  });

  it('filters rows by name and shows the count', async () => {
    await renderPanel();
    expect(screen.getByText('6 of 6 tools')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'git' } });
    expect(screen.getByText('1 of 6 tools')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'file_read_many' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No tools match your search.')).toBeInTheDocument();
  });

  it('marks unavailable upstream rows but keeps them toggleable', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Expand docs' }));
    const row = screen.getByRole('switch', { name: 'docs__search' }).closest('li');
    expect(row).toHaveClass('is-unavailable');
    expect(within(row as HTMLElement).getByText('Server not active')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'docs__search' })).not.toBeDisabled();
  });

  it('saves one PUT with the disabled names and toasts', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Aevra: git' }));
    fireEvent.click(screen.getByRole('switch', { name: 'git_status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save tool switches' }));
    await waitFor(() => expect(service.saveToolSwitches).toHaveBeenCalledTimes(1));
    expect(service.saveToolSwitches).toHaveBeenCalledWith(['docs__fetch', 'git_status']);
    expect(await screen.findByText('Tool switches saved.')).toBeInTheDocument();
  });

  it('toasts an error when saving fails', async () => {
    vi.mocked(service.saveToolSwitches).mockRejectedValue(new Error('boom'));
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Save tool switches' }));
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('shows an unavailable message when loading fails', async () => {
    vi.mocked(service.fetchToolSwitches).mockRejectedValue(new Error('nope'));
    render(<ToolSwitchSettings />);
    expect(await screen.findByText('Tool switches unavailable.')).toBeInTheDocument();
  });
});
