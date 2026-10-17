import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import {
  MCP_UPSTREAM_REFRESH_MS,
  McpUpstreamsSettings,
  type UpstreamSummary,
} from './McpUpstreamsSettings';

const active: UpstreamSummary = {
  id: 'u1',
  name: 'github',
  transport: 'http',
  config: { url: 'https://mcp.example.com/mcp' },
  auth: { kind: 'none' },
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

const pending: UpstreamSummary = {
  ...active,
  state: 'needs-review',
  pendingCatalogFingerprint: 'fp-one',
  pendingCatalogDiff: { added: ['tool:new_tool'], removed: [], changed: [] },
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function mount(load = vi.fn().mockResolvedValue([active]), overrides = {}) {
  const acknowledge = vi.fn().mockResolvedValue(active),
    setEnabled = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <DialogProvider>
      <McpUpstreamsSettings
        load={load}
        acknowledge={acknowledge}
        setEnabled={setEnabled}
        {...overrides}
      />
    </DialogProvider>,
  );
  await flush();
  return { load, acknowledge, setEnabled, ...view };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

describe('McpUpstreamsSettings auto refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  });

  it('exports a 30 second default interval', () => {
    expect(MCP_UPSTREAM_REFRESH_MS).toBe(30_000);
  });

  it('reloads every 30s', async () => {
    const { load } = await mount();
    expect(load).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads on visibility and focus', async () => {
    const { load } = await mount();
    setVisibility('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('skips tick while edit modal open', async () => {
    const { load } = await mount();
    fireEvent.click(screen.getByRole('button', { name: /edit github/i }));
    expect(screen.getByLabelText(/server name/i)).toBeInTheDocument();
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('skips tick while busy', async () => {
    let release: () => void = () => {};
    const setEnabled = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { load } = await mount(undefined, { setEnabled });
    fireEvent.click(screen.getByRole('switch', { name: 'Enable github' }));
    await flush();
    expect(setEnabled).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('open review dialog keeps snapshot across refresh', async () => {
    const load = vi.fn().mockResolvedValueOnce([pending]).mockResolvedValue([active]);
    const { acknowledge } = await mount(load);
    const row = screen.getByRole('row', { name: /github/i });
    fireEvent.click(
      within(row).getByRole('button', { name: /review catalog changes for github/i }),
    );
    expect(screen.getByRole('dialog', { name: /review changes/i })).toBeInTheDocument();
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(2);
    const dialog = screen.getByRole('dialog', { name: /review changes/i });
    expect(dialog.textContent).toMatch(/new_tool/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept changes' }));
    await flush();
    expect(acknowledge).toHaveBeenCalledWith('u1', 'fp-one');
  });

  it('interval cleared on unmount', async () => {
    const { load, unmount } = await mount();
    unmount();
    await advance(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('honours a custom refreshMs', async () => {
    const { load } = await mount(undefined, { refreshMs: 1_000 });
    await advance(3_000);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
