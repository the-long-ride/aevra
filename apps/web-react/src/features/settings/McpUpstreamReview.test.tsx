import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { McpUpstreamRowActions } from './McpUpstreamRowActions';
import { McpUpstreamReviewModal } from './McpUpstreamReviewModal';
import { McpUpstreamsSettings, type UpstreamSummary } from './McpUpstreamsSettings';
import { isPendingReview, isReviewable, parseDiffKey } from './mcp-upstream-review';

const plainPhrase1 = 'sr_github';
const reviewTitle = (name: string) => `Review changes \u2014 ${name}`;

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

const pending = (overrides: Partial<UpstreamSummary> = {}): UpstreamSummary => ({
  ...active,
  state: 'needs-review',
  pendingCatalogFingerprint: 'fp-one',
  pendingCatalogDiff: { added: ['tool:create_issue'], removed: [], changed: [] },
  ...overrides,
});

function mount(upstreams: UpstreamSummary[] = [active], overrides = {}) {
  const test = vi.fn().mockResolvedValue({
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
        create={vi.fn()}
        update={vi.fn()}
        remove={vi.fn()}
        test={test}
        acknowledge={acknowledge}
        setEnabled={vi.fn()}
        {...overrides}
      />
    </DialogProvider>,
  );
  return { load, test, acknowledge };
}

const reviewButtons = () => screen.queryAllByRole('button', { name: /Review catalog changes for/ });

describe('MCP upstream review', () => {
  it('classifies rows and splits diff keys at the first colon', () => {
    expect(isPendingReview(pending())).toBe(true);
    expect(isPendingReview(pending({ enabled: false }))).toBe(false);
    expect(isPendingReview(active)).toBe(false);
    expect(isReviewable(pending())).toBe(true);
    expect(isReviewable(pending({ pendingCatalogFingerprint: null }))).toBe(false);
    expect(isReviewable(pending({ pendingCatalogDiff: null }))).toBe(false);
    expect(parseDiffKey('resource:repo:///readme')).toEqual({
      kind: 'resource',
      name: 'repo:///readme',
    });
    expect(parseDiffKey('prompt:b')).toEqual({ kind: 'prompt', name: 'b' });
    expect(parseDiffKey('legacy_tool')).toEqual({ kind: 'tool', name: 'legacy_tool' });
  });

  it('shows review icon only for enabled needs-review rows', async () => {
    mount([
      active,
      pending({ id: 'u2', name: 'gitlab' }),
      pending({ id: 'u3', name: 'bitbucket', enabled: false }),
    ]);
    await screen.findByRole('row', { name: 'gitlab' });
    expect(reviewButtons()).toHaveLength(1);
    const button = screen.getByRole('button', { name: 'Review catalog changes for gitlab' });
    expect(button).toHaveAttribute('title', 'Catalog changed \u2014 review');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('server column has no diff text', async () => {
    mount([
      pending({ pendingCatalogDiff: { added: ['tool:create_issue'], removed: [], changed: [] } }),
    ]);
    await screen.findByRole('row', { name: 'github' });
    expect(screen.queryByText(/Added: create_issue/)).toBeNull();
    expect(screen.queryByText(/create_issue/)).toBeNull();
  });

  it('icon opens dialog with grouped diff', async () => {
    const user = userEvent.setup();
    mount([
      pending({
        pendingCatalogDiff: {
          added: ['tool:a'],
          removed: ['prompt:b', 'tool:c'],
          changed: ['resource:repo:///readme'],
        },
      }),
    ]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    const dialog = screen.getByRole('dialog', { name: reviewTitle('github') });
    expect(dialog).toHaveTextContent(
      'This server changed its catalog. Its tools are not served to the AI until you accept the change.',
    );
    expect(dialog).toHaveTextContent(
      'Pending catalog \u2014 these tool instructions have not been acknowledged. Viewing them does not accept the catalog change.',
    );
    expect(within(dialog).getByText('a')).toBeInTheDocument();
    expect(within(dialog).getByText('b')).toBeInTheDocument();
    expect(within(dialog).getByText('repo:///readme')).toBeInTheDocument();
    expect(within(dialog).queryByText('resource:repo:///readme')).toBeNull();
    expect(within(dialog).getByText('c')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Added (1)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Removed (2)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Changed (1)' })).toBeInTheDocument();
  });

  it('omits empty groups from the dialog', async () => {
    const user = userEvent.setup();
    mount([pending({ pendingCatalogDiff: { added: ['tool:a'], removed: [], changed: [] } })]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    const dialog = screen.getByRole('dialog', { name: reviewTitle('github') });
    expect(within(dialog).getByRole('heading', { name: 'Added (1)' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: /Removed/ })).toBeNull();
    expect(within(dialog).queryByRole('heading', { name: /Changed/ })).toBeNull();
  });

  it('expands added tool entries that match the row tools', async () => {
    const user = userEvent.setup();
    mount([
      pending({
        tools: [{ name: 'create_issue', description: 'Opens an issue' }],
        pendingCatalogDiff: {
          added: ['tool:create_issue', 'tool:unknown_tool'],
          removed: [],
          changed: [],
        },
      }),
    ]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    const dialog = screen.getByRole('dialog', { name: reviewTitle('github') });
    expect(dialog).toHaveTextContent('Opens an issue');
    expect(within(dialog).getByText('unknown_tool')).toBeInTheDocument();
  });

  it('accept sends opened fingerprint', async () => {
    const user = userEvent.setup();
    const { acknowledge, load } = mount([pending({ pendingCatalogFingerprint: 'fp-one' })]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Accept changes' }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('u1', 'fp-one'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('cancel closes the dialog without accepting', async () => {
    const user = userEvent.setup();
    const { acknowledge } = mount([pending()]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('removed-only diff can be accepted', async () => {
    const user = userEvent.setup();
    const { acknowledge } = mount([
      pending({ pendingCatalogDiff: { added: [], removed: ['tool:x'], changed: [] } }),
    ]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    const accept = screen.getByRole('button', { name: 'Accept changes' });
    expect(accept).toBeEnabled();
    const dialog = screen.getByRole('dialog', { name: reviewTitle('github') });
    expect(within(dialog).getByText('x')).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Removed (1)' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: /Added|Changed/ })).toBeNull();
    await user.click(accept);
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('u1', 'fp-one'));
  });

  it('blocked row shows Test now and no Accept', async () => {
    const user = userEvent.setup();
    const { test, load } = mount([
      pending({ pendingCatalogDiff: null, pendingCatalogFingerprint: null }),
    ]);
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    const dialog = screen.getByRole('dialog', { name: reviewTitle('github') });
    expect(dialog).toHaveTextContent(
      "Aevra blocked a request to an entry outside the reviewed catalog. Press Test to fetch the server's current catalog, then review it here.",
    );
    expect(screen.queryByRole('button', { name: 'Accept changes' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Test now' }));
    await waitFor(() => expect(test).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('catalog-changed error closes dialog and reloads', async () => {
    const user = userEvent.setup();
    const acknowledge = vi
      .fn()
      .mockRejectedValue({ code: 'MCP_UPSTREAM_CATALOG_CHANGED', message: 'changed' });
    const { load } = mount([pending()], { acknowledge });
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Accept changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('closes the dialog on the plain Error the admin client throws for a changed catalog', async () => {
    const user = userEvent.setup();
    const message = 'The catalog changed after review; refresh and review it again';
    const acknowledge = vi.fn().mockRejectedValue(new Error(message));
    const { load } = mount([pending()], { acknowledge });
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Accept changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The catalog changed after you opened the review. The list was refreshed - review it again.',
    );
  });

  it('keeps the dialog open and toasts on other accept failures', async () => {
    const user = userEvent.setup();
    const acknowledge = vi.fn().mockRejectedValue(new Error('Accept refused'));
    mount([pending()], { acknowledge });
    await user.click(
      await screen.findByRole('button', { name: /Review catalog changes for github/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Accept changes' }));
    expect(await screen.findByText('Accept refused')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: reviewTitle('github') })).toBeInTheDocument();
  });

  it('shows a neutral line and only Cancel when the row no longer needs review', () => {
    const onClose = vi.fn();
    render(
      <McpUpstreamReviewModal
        row={active}
        busy={false}
        onAccept={vi.fn()}
        onTest={vi.fn()}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: reviewTitle('github') });
    expect(dialog).toHaveTextContent('This server no longer needs review.');
    expect(dialog).not.toHaveTextContent(/Aevra blocked a request/);
    expect(dialog).not.toHaveTextContent(/changed its catalog/);
    expect(within(dialog).queryByRole('button', { name: 'Test now' })).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Accept changes' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('notice counts enabled pending rows only', async () => {
    mount([
      pending({ id: 'u1', name: 'one' }),
      pending({ id: 'u2', name: 'two' }),
      pending({ id: 'u3', name: 'three', enabled: false }),
    ]);
    expect(
      await screen.findByText('2 servers need review \u2014 click \u26A0 to see what changed.'),
    ).toBeInTheDocument();
  });

  it('notice uses singular copy for one row and is absent for none', async () => {
    mount(
      [pending(), active].map((row, index) => ({ ...row, id: `u${index}`, name: `s${index}` })),
    );
    expect(
      await screen.findByText('1 server needs review \u2014 click \u26A0 to see what changed.'),
    ).toBeInTheDocument();
  });

  it('notice and dialog copy use the real em dash and warning sign, not ASCII stand-ins', async () => {
    const user = userEvent.setup();
    mount([pending()]);
    const notice = await screen.findByText(/server needs review/);
    expect(notice.textContent).not.toContain('?');
    expect(notice.textContent).not.toContain(' - ');
    expect(notice.textContent).toContain(String.fromCharCode(0x2014));
    expect(notice.textContent).toContain(String.fromCharCode(0x26a0));
    await user.click(screen.getByRole('button', { name: /Review catalog changes for github/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('h2')?.textContent).toBe(
      `Review changes ${String.fromCharCode(0x2014)} github`,
    );
    expect(dialog.textContent).not.toContain('Pending catalog - ');
  });

  it('renders no notice when nothing needs review', async () => {
    mount([active, pending({ id: 'u2', name: 'off', enabled: false })]);
    await screen.findByRole('row', { name: 'github' });
    expect(screen.queryByText(/need review|needs review \u2014 click/)).toBeNull();
    expect(reviewButtons()).toHaveLength(0);
  });

  it('row actions no longer have Acknowledge', () => {
    render(
      <McpUpstreamRowActions
        row={pending()}
        busy={false}
        onHints={vi.fn()}
        onToggle={vi.fn()}
        onTest={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Acknowledge/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Test github' }));
  });
});
