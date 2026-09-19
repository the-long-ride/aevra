import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { McpUpstreamsSettings, type UpstreamSummary } from './McpUpstreamsSettings';

const active: UpstreamSummary = {
  id: 'u1',
  name: 'github',
  transport: 'http',
  config: { url: 'https://mcp.example.com/mcp' },
  auth: { kind: 'header', header: 'Authorization', secretRefId: 'sr_github' },
  risk: 'HIGH',
  enabled: true,
  state: 'active',
  toolCount: 12,
  resourceCount: 2,
  promptCount: 0,
  pendingCatalogDiff: null,
  advisory: [],
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
};

function mount(upstreams: UpstreamSummary[] = [active], overrides = {}) {
  const create = vi.fn().mockResolvedValue(active),
    update = vi.fn().mockResolvedValue({ ...active, name: 'github-renamed' }),
    remove = vi.fn().mockResolvedValue({ ok: true }),
    test = vi.fn().mockResolvedValue({
      ok: true,
      serverName: 'github-mcp',
      serverVersion: '1.2.3',
      toolCount: 12,
      resourceCount: 2,
      promptCount: 0,
      state: 'active',
      message: null,
    }),
    acknowledge = vi.fn().mockResolvedValue({ ...active, state: 'active' }),
    load = vi.fn().mockResolvedValue(upstreams);
  render(
    <DialogProvider>
      <McpUpstreamsSettings
        load={load}
        create={create}
        update={update}
        remove={remove}
        test={test}
        acknowledge={acknowledge}
        {...overrides}
      />
    </DialogProvider>,
  );
  return { load, create, update, remove, test, acknowledge };
}

describe('McpUpstreamsSettings', () => {
  it('lists status, tool count and risk', async () => {
    mount();
    const row = await screen.findByRole('listitem', { name: /github/i });
    expect(row.textContent).toMatch(/active/i);
    expect(row.textContent).toMatch(/12 tools/i);
    expect(row.textContent).toMatch(/HIGH/);
  });

  it('shows empty state', async () => {
    mount([]);
    expect(await screen.findByText(/no mcp servers are registered/i)).toBeTruthy();
  });

  it('badges degraded and handles stdio command display', async () => {
    mount([
      {
        ...active,
        state: 'degraded',
        transport: 'stdio',
        config: { command: 'node', args: ['server.js'] },
      },
    ]);
    const row = await screen.findByRole('listitem', { name: /github/i });
    expect(row.textContent).toMatch(/degraded/i);
    expect(row.textContent).toMatch(/node server\.js/);
  });

  it('tests a server and reports identity on success, and failure message on test failure', async () => {
    const { test } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /test github/i }));
    await waitFor(() => expect(test).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText(/github-mcp 1\.2\.3/)).toBeTruthy();

    // Test failure case
    test.mockResolvedValueOnce({
      ok: false,
      serverName: null,
      serverVersion: null,
      toolCount: 0,
      resourceCount: 0,
      promptCount: 0,
      state: 'degraded',
      message: 'Connection timed out',
    });
    fireEvent.click(screen.getByRole('button', { name: /test github/i }));
    expect(await screen.findByText('Connection timed out')).toBeInTheDocument();
  });

  it('removes a server with cancel and confirm', async () => {
    const user = userEvent.setup();
    const { remove } = mount();
    await user.click(await screen.findByRole('button', { name: /remove github/i }));
    let removeDialog = screen.getByRole('dialog', { name: 'Remove MCP server' });
    await user.click(within(removeDialog).getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /remove github/i }));
    removeDialog = screen.getByRole('dialog', { name: 'Remove MCP server' });
    await user.click(within(removeDialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u1'));
  });

  it('adds a new server via Add server button', async () => {
    const user = userEvent.setup();
    const { create } = mount();
    await user.click(screen.getByRole('button', { name: 'Add server' }));

    expect(screen.getByRole('dialog', { name: /add mcp server/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/server name/i), 'new-mcp');
    await user.type(screen.getByLabelText(/server url/i), 'https://mcp.test.com');
    await user.click(screen.getByRole('button', { name: /save server/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'new-mcp',
          transport: 'http',
          config: { url: 'https://mcp.test.com' },
        }),
      );
    });
  });

  it('handles modal close', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Add server' }));
    expect(screen.getByRole('dialog', { name: /add mcp server/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: /add mcp server/i })).not.toBeInTheDocument();
  });

  it('edits an existing server through the update endpoint', async () => {
    const { update } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /edit github/i }));
    expect(screen.getByLabelText(/server name/i)).toHaveValue('github');
    fireEvent.change(screen.getByLabelText(/server name/i), {
      target: { value: 'github-renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({
          name: 'github-renamed',
        }),
      ),
    );
  });

  it('handles load error and submit error', async () => {
    mount([], {
      load: () => Promise.reject(new Error('Network offline')),
    });
    expect(await screen.findByText('Network offline')).toBeInTheDocument();
  });

  it('handles submit error in edit modal', async () => {
    const user = userEvent.setup();
    mount([active], {
      create: () => Promise.reject(new Error('Server name already exists')),
    });
    await user.click(screen.getByRole('button', { name: 'Add server' }));
    await user.type(screen.getByLabelText(/server name/i), 'existing-name');
    await user.type(screen.getByLabelText(/server url/i), 'https://test.com');
    await user.click(screen.getByRole('button', { name: /save server/i }));
    expect(await screen.findByText('Server name already exists')).toBeInTheDocument();
  });

  it('shows review diff and acknowledge', async () => {
    const { acknowledge } = mount([
      {
        ...active,
        state: 'needs-review',
        pendingCatalogDiff: {
          added: ['new_tool'],
          removed: ['old_tool'],
          changed: ['create_issue'],
        },
      },
    ]);
    const row = await screen.findByRole('listitem', { name: /github/i });
    expect(row.textContent).toMatch(/new_tool/);
    expect(row.textContent).toMatch(/old_tool/);
    fireEvent.click(screen.getByRole('button', { name: /acknowledge github/i }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('u1'));
  });

  it('labels hints advisory and handles non-read-only claims', async () => {
    mount([
      {
        ...active,
        risk: 'CRITICAL',
        advisory: [
          { tool: 'delete_repo', readOnlyHint: true },
          { tool: 'update_repo', readOnlyHint: false },
        ],
      },
    ]);
    const row = await screen.findByRole('listitem', { name: /github/i });
    expect(row.textContent).toMatch(/advisory only/i);
    expect(row.textContent).toMatch(/does not affect the risk tier/i);
    expect(row.textContent).toMatch(/delete_repo/);
    expect(row.textContent).toMatch(/claims read-only/);
    expect(row.textContent).toMatch(/no read-only claim/);
    expect(row.textContent).toMatch(/CRITICAL/);
  });
});
