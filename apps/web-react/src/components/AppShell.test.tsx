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
});
