import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
function mount(upstreams: UpstreamSummary[] = [active]) {
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
    acknowledge = vi.fn().mockResolvedValue({ ...active, state: 'active' });
  render(
    <McpUpstreamsSettings
      load={() => Promise.resolve(upstreams)}
      create={create}
      update={update}
      remove={remove}
      test={test}
      acknowledge={acknowledge}
    />,
  );
  return { create, update, remove, test, acknowledge };
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
  it('badges degraded', async () => {
    mount([{ ...active, state: 'degraded' }]);
    expect((await screen.findByRole('listitem', { name: /github/i })).textContent).toMatch(
      /degraded/i,
    );
  });
  it('tests a server and reports identity', async () => {
    const { test } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /test github/i }));
    await waitFor(() => expect(test).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText(/github-mcp 1\.2\.3/)).toBeTruthy();
  });
  it('removes a server', async () => {
    const { remove } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /remove github/i }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('u1'));
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
  it('labels hints advisory and keeps operator risk visible', async () => {
    mount([
      { ...active, risk: 'CRITICAL', advisory: [{ tool: 'delete_repo', readOnlyHint: true }] },
    ]);
    const row = await screen.findByRole('listitem', { name: /github/i });
    expect(row.textContent).toMatch(/advisory only/i);
    expect(row.textContent).toMatch(/does not affect the risk tier/i);
    expect(row.textContent).toMatch(/delete_repo/);
    expect(row.textContent).toMatch(/CRITICAL/);
  });
});
