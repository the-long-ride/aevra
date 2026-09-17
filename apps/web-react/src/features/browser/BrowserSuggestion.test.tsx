import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSuggestion } from './BrowserSuggestion';
import { loadBrowserExtensionState } from './browser-extension-service';

vi.mock('./browser-extension-service', () => ({
  loadBrowserExtensionState: vi.fn(),
}));

const load = vi.mocked(loadBrowserExtensionState);

beforeEach(() => {
  load.mockReset();
});

function findButton() {
  return screen.queryByRole('button', { name: 'Aevra can control your browser' });
}

describe('BrowserSuggestion', () => {
  it('prompts when no extension is paired', async () => {
    load.mockResolvedValue({ extensionId: null, pairedAt: null });
    render(<BrowserSuggestion />);
    await waitFor(() => expect(findButton()).toBeInTheDocument());
  });

  it('stays out of the way once an extension is paired', async () => {
    load.mockResolvedValue({ extensionId: 'a'.repeat(32), pairedAt: '2026-01-01T00:00:00Z' });
    render(<BrowserSuggestion />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(findButton()).not.toBeInTheDocument();
  });

  it('says nothing when Aevra cannot tell, rather than guessing', async () => {
    load.mockRejectedValue(new Error('browser control is unavailable'));
    render(<BrowserSuggestion />);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(findButton()).not.toBeInTheDocument();
  });

  it('opens a modal carrying the download and the guide', async () => {
    const user = userEvent.setup();
    load.mockResolvedValue({ extensionId: null, pairedAt: null });
    render(<BrowserSuggestion />);
    await user.click(await screen.findByRole('button', { name: /control your browser/ }));

    const dialog = screen.getByRole('dialog', { name: 'Browser control' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download the extension' })).toHaveAttribute(
      'href',
      'https://github.com/the-long-ride/aevra/releases/latest',
    );
    // The in-app chapter, not the GitHub copy: it has to work offline.
    expect(screen.getByRole('link', { name: 'Read the setup guide' })).toHaveAttribute(
      'href',
      '#guide',
    );
  });

  it('closes on Not now', async () => {
    const user = userEvent.setup();
    load.mockResolvedValue({ extensionId: null, pairedAt: null });
    render(<BrowserSuggestion />);
    await user.click(await screen.findByRole('button', { name: /control your browser/ }));
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    load.mockResolvedValue({ extensionId: null, pairedAt: null });
    render(<BrowserSuggestion />);
    await user.click(await screen.findByRole('button', { name: /control your browser/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the backdrop is clicked but not the panel', async () => {
    const user = userEvent.setup();
    load.mockResolvedValue({ extensionId: null, pairedAt: null });
    render(<BrowserSuggestion />);
    await user.click(await screen.findByRole('button', { name: /control your browser/ }));

    await user.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(document.querySelector('.browser-setup-backdrop') as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when the guide link is followed, so the page is not left covered', async () => {
    const user = userEvent.setup();
    load.mockResolvedValue({ extensionId: null, pairedAt: null });
    render(<BrowserSuggestion />);
    await user.click(await screen.findByRole('button', { name: /control your browser/ }));
    await user.click(screen.getByRole('link', { name: 'Read the setup guide' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
