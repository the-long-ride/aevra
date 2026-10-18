import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { McpUpstreamsSettings, type UpstreamSummary } from './McpUpstreamsSettings';

const plainPhrase1 = 'sr_github';

const active: UpstreamSummary = {
  id: 'u1',
  name: 'github',
  transport: 'http',
  config: { url: 'https://mcp.example.com/mcp' },
  auth: { kind: 'header', header: 'Authorization', secretRefId: plainPhrase1 },
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
    setEnabled = vi.fn().mockResolvedValue(undefined),
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
        setEnabled={setEnabled}
        {...overrides}
      />
    </DialogProvider>,
  );
  return { load, create, update, remove, test, acknowledge, setEnabled };
}

describe('McpUpstreamsSettings', () => {
  it('lists status, tool count and risk', async () => {
    mount();
    const row = await screen.findByRole('row', { name: /github/i });
    expect(row.textContent).toMatch(/active/i);
    expect(within(row).getByText('Active')).toHaveClass('success');
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
    const row = await screen.findByRole('row', { name: /github/i });
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
    expect(await screen.findByText(/Connection timed out/)).toBeInTheDocument();
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

  it('shows the review diff in the dialog and accepts through it', async () => {
    const { acknowledge } = mount([
      {
        ...active,
        state: 'needs-review',
        pendingCatalogFingerprint: 'reviewed fingerprint',
        pendingCatalogDiff: {
          added: ['tool:new_tool'],
          removed: ['tool:old_tool'],
          changed: ['tool:create_issue'],
        },
      },
    ]);
    const row = await screen.findByRole('row', { name: /github/i });
    expect(row.textContent).not.toMatch(/new_tool/);
    expect(row.textContent).not.toMatch(/old_tool/);
    fireEvent.click(
      within(row).getByRole('button', { name: /review catalog changes for github/i }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Review changes — github' });
    expect(dialog.textContent).toMatch(/new_tool/);
    expect(dialog.textContent).toMatch(/old_tool/);
    expect(dialog.textContent).toMatch(/create_issue/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept changes' }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('u1', 'reviewed fingerprint'));
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
    const row = await screen.findByRole('row', { name: /github/i });
    expect(row.querySelector('details')).toBeNull();
    const user = userEvent.setup();
    const trigger = within(row).getByRole('button', { name: 'Detail for github' });
    await user.click(trigger);
    const modal = screen.getByRole('dialog', { name: 'Detail — github' });
    expect(modal).toHaveTextContent(/advisory only/i);
    expect(modal).toHaveTextContent(/does not affect the risk tier/i);
    expect(modal).toHaveTextContent('delete_repo');
    expect(modal).toHaveTextContent('claims read-only');
    expect(modal).toHaveTextContent('no read-only claim');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(row.textContent).toMatch(/CRITICAL/);
  });

  it('toggles a server through the switch and refreshes', async () => {
    const { setEnabled, load } = mount();
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable github' }));
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith('u1', false));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('enables a disabled server and marks the row as disabled', async () => {
    const { setEnabled } = mount([{ ...active, enabled: false }]);
    const row = await screen.findByRole('row', { name: /github/i });
    expect(within(row).getByText('Disabled')).toBeInTheDocument();
    expect(row.className).toMatch(/is-disabled/);
    expect(within(row).queryByText('Active')).toBeNull();
    expect(row.querySelectorAll('.status')).toHaveLength(1);
    fireEvent.click(within(row).getByRole('switch', { name: 'Enable github' }));
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith('u1', true));
  });

  it('does not badge or dim an enabled server', async () => {
    mount();
    const row = await screen.findByRole('row', { name: /github/i });
    expect(within(row).queryByText('Disabled')).toBeNull();
    expect(row.className).not.toMatch(/is-disabled/);
  });

  it('ignores a second toggle while the first is in flight', async () => {
    let release: () => void = () => {};
    const setEnabled = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    mount([active], { setEnabled });
    const toggle = await screen.findByRole('switch', { name: 'Enable github' });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeDisabled());
    fireEvent.click(toggle);
    expect(setEnabled).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it('shows the error toast when toggling fails', async () => {
    const setEnabled = vi.fn().mockRejectedValue(new Error('Toggle refused'));
    mount([active], { setEnabled });
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable github' }));
    expect(await screen.findByText('Toggle refused')).toBeInTheDocument();
  });

  it('filters rows by Enabled and Disabled', async () => {
    const user = userEvent.setup();
    mount([active, { ...active, id: 'u2', name: 'gitlab', enabled: false }]);
    await screen.findByRole('row', { name: /github/i });
    await user.click(screen.getByRole('button', { name: 'Enabled' }));
    await user.click(screen.getByRole('option', { name: 'Disabled' }));
    expect(screen.queryByRole('row', { name: /github/i })).toBeNull();
    expect(screen.getByRole('row', { name: /gitlab/i })).toBeInTheDocument();
  });

  it('edits a disabled server without sending enabled', async () => {
    const { update } = mount([{ ...active, enabled: false }]);
    fireEvent.click(await screen.findByRole('button', { name: /edit github/i }));
    fireEvent.click(screen.getByRole('button', { name: /save server/i }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![1]).not.toHaveProperty('enabled');
  });
});

it('filters by the displayed status of disabled servers', async () => {
  const user = userEvent.setup();
  mount([active, { ...active, id: 'u2', name: 'gitlab', enabled: false }]);
  await screen.findByRole('row', { name: 'gitlab' });
  await user.click(
    screen
      .getAllByRole('button', { name: 'Status' })
      .find((button) => button.getAttribute('aria-haspopup') === 'listbox')!,
  );
  await user.click(screen.getByRole('option', { name: 'Active' }));
  expect(screen.queryByRole('row', { name: 'gitlab' })).toBeNull();
  expect(screen.getByRole('row', { name: 'github' })).toBeInTheDocument();
  await user.click(
    screen
      .getAllByRole('button', { name: 'Status' })
      .find((button) => button.getAttribute('aria-haspopup') === 'listbox')!,
  );
  await user.click(screen.getByRole('option', { name: 'Disabled' }));
  expect(screen.getByRole('row', { name: 'gitlab' })).toBeInTheDocument();
  expect(screen.queryByRole('row', { name: 'github' })).toBeNull();
});
