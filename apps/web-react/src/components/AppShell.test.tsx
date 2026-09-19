import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AppShell, isVersionOutdated } from './AppShell';

describe('isVersionOutdated', () => {
  test('correctly identifies outdated semver versions', () => {
    expect(isVersionOutdated('0.1.0', '0.1.1')).toBe(true);
    expect(isVersionOutdated('0.1.0', '0.2.0')).toBe(true);
    expect(isVersionOutdated('0.1.0', '1.0.0')).toBe(true);
    expect(isVersionOutdated('v0.1.0', '0.1.1')).toBe(true);
    expect(isVersionOutdated('0.1.0', 'v0.1.1')).toBe(true);
  });

  test('returns false when current version is up to date or newer', () => {
    expect(isVersionOutdated('0.1.1', '0.1.1')).toBe(false);
    expect(isVersionOutdated('0.2.0', '0.1.1')).toBe(false);
    expect(isVersionOutdated('1.0.0', '0.9.9')).toBe(false);
    expect(isVersionOutdated('', '0.1.1')).toBe(false);
    expect(isVersionOutdated('0.1.1', '')).toBe(false);
  });
});

describe('AppShell version update button', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('shows update command button when outdated and copies to clipboard on click', async () => {
    const user = userEvent.setup();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.2.0' }),
    }) as any;

    render(
      <AppShell
        page="dashboard"
        status={{ version: '0.1.0', core: 'ready' }}
        theme="dark"
        pendingCount={0}
        requestsOpen={false}
        onNavigate={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenRequests={vi.fn()}
      >
        <div>Content</div>
      </AppShell>,
    );

    const updateBtn = await screen.findByRole('button', {
      name: 'Click to copy update command',
    });
    expect(updateBtn).toBeInTheDocument();
    expect(updateBtn).toHaveTextContent('npm i -g @the-long-ride/aevra@latest');

    await user.click(updateBtn);
    expect(writeTextMock).toHaveBeenCalledWith('npm i -g @the-long-ride/aevra@latest');
    expect(screen.getByText('[copied]')).toBeInTheDocument();
  });

  test('does not show update button when current version is equal to npm version', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0.1.1' }),
    }) as any;

    render(
      <AppShell
        page="dashboard"
        status={{ version: '0.1.1', core: 'ready' }}
        theme="dark"
        pendingCount={0}
        requestsOpen={false}
        onNavigate={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenRequests={vi.fn()}
      >
        <div>Content</div>
      </AppShell>,
    );

    expect(
      screen.queryByRole('button', { name: 'Click to copy update command' }),
    ).not.toBeInTheDocument();
  });

  test('shows browser chip with red dot when not installed, and opens setup modal on click', async () => {
    const user = userEvent.setup();
    render(
      <AppShell
        page="dashboard"
        status={{ version: '1.0.5', core: 'ready' }}
        theme="dark"
        pendingCount={0}
        requestsOpen={false}
        onNavigate={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenRequests={vi.fn()}
      >
        <div>Content</div>
      </AppShell>,
    );

    const browserChip = screen.getByRole('button', {
      name: /Browser extension not installed/i,
    });
    expect(browserChip).toBeInTheDocument();
    expect(browserChip).toHaveAttribute('data-state', 'error');

    await user.click(browserChip);
    expect(screen.getByRole('dialog', { name: 'Browser control' })).toBeInTheDocument();
  });

  test('shows extension mismatch update notice when installed extension version differs', async () => {
    document.documentElement.setAttribute('data-aevra-extension-installed', 'true');
    document.documentElement.setAttribute('data-aevra-extension-version', '0.1.0');

    render(
      <AppShell
        page="dashboard"
        status={{ version: '1.0.5', core: 'ready' }}
        theme="dark"
        pendingCount={0}
        requestsOpen={false}
        onNavigate={vi.fn()}
        onToggleTheme={vi.fn()}
        onOpenRequests={vi.fn()}
      >
        <div>Content</div>
      </AppShell>,
    );

    const mismatchBtn = await screen.findByRole('button', {
      name: 'Extension update recommended',
    });
    expect(mismatchBtn).toBeInTheDocument();
    expect(mismatchBtn).toHaveTextContent('ext v0.1.0 ≠ v1.0.5 (update)');

    const browserChip = screen.getByRole('button', {
      name: /Browser extension installed \(v0.1.0\)/i,
    });
    expect(browserChip).toHaveAttribute('data-state', 'ok');

    document.documentElement.removeAttribute('data-aevra-extension-installed');
    document.documentElement.removeAttribute('data-aevra-extension-version');
  });
});
