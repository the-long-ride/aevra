import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSetupModal } from './BrowserSetupModal';
import * as extHook from './use-browser-extension';

describe('BrowserSetupModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders modal content and handles close button and escape key', () => {
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'missing',
      isInstalled: false,
      version: null,
    });

    const onClose = vi.fn();
    render(<BrowserSetupModal onClose={onClose} aevraVersion="1.0.5" />);

    expect(screen.getByRole('dialog', { name: 'Browser control' })).toBeInTheDocument();
    expect(screen.getByText(/Aevra can control your browser/i)).toBeInTheDocument();

    // Close button
    const closeBtn = screen.getByRole('button', { name: 'Not now' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    // Escape key
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // Verify bottom note was removed
    expect(screen.queryByText(/Prefer the published version/i)).toBeNull();
  });

  it('closes when clicking backdrop', () => {
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'missing',
      isInstalled: false,
      version: null,
    });

    const onClose = vi.fn();
    const { container } = render(<BrowserSetupModal onClose={onClose} />);
    const backdrop = container.querySelector('.browser-setup-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('displays mismatch banner when installed version differs from Aevra version', () => {
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'paired',
      isInstalled: true,
      version: '1.0.0',
    });

    render(<BrowserSetupModal onClose={() => {}} aevraVersion="1.0.5" />);

    expect(screen.getByText('Extension version mismatch detected')).toBeInTheDocument();
    expect(screen.getByText(/Your browser extension is/i)).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('v1.0.5')).toBeInTheDocument();
  });

  it('does not display mismatch banner when versions match', () => {
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'paired',
      isInstalled: true,
      version: '1.0.5',
    });

    render(<BrowserSetupModal onClose={() => {}} aevraVersion="1.0.5" />);
    expect(screen.queryByText('Extension version mismatch detected')).toBeNull();
  });

  it('links to dynamic extension zip download when aevraVersion is supplied', () => {
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'missing',
      isInstalled: false,
      version: null,
    });

    render(<BrowserSetupModal onClose={() => {}} aevraVersion="v1.0.5" />);
    const downloadLink = screen.getByRole('link', { name: 'Download the extension' });
    expect(downloadLink).toHaveAttribute(
      'href',
      expect.stringContaining('/download/v1.0.5/aevra-extension.zip'),
    );
  });

  it('supports generating and copying pairing code directly inside modal', async () => {
    const user = userEvent.setup();
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'missing',
      isInstalled: true,
      version: '1.1.0',
    });

    const createCodeMock = vi.fn().mockResolvedValue({
      code: 'PAIR-777',
      expiresAt: '2026-01-01T00:05:00Z',
    });

    let writeTextArg = '';
    const writeTextSpy = vi.fn().mockImplementation(async (text: string) => {
      writeTextArg = text;
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });

    render(<BrowserSetupModal onClose={() => {}} createCode={createCodeMock} />);

    const pairBtn = screen.getByRole('button', { name: 'Pair extension' });
    await user.click(pairBtn);

    expect(createCodeMock).toHaveBeenCalled();
    expect(await screen.findByText('PAIR-777')).toBeInTheDocument();

    const copyBtn = screen.getByRole('button', { name: 'Copy code' });
    await user.click(copyBtn);

    expect(writeTextSpy).toHaveBeenCalledWith('PAIR-777');
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('displays paired status when extension is already paired', () => {
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'paired',
      isInstalled: true,
      version: '1.1.0',
    });

    render(<BrowserSetupModal onClose={() => {}} />);
    expect(screen.getByText('Browser extension is paired and connected.')).toBeInTheDocument();
  });

  it('handles pairing code generation failure', async () => {
    const user = userEvent.setup();
    vi.spyOn(extHook, 'useBrowserExtensionInfo').mockReturnValue({
      status: 'missing',
      isInstalled: false,
      version: null,
    });

    const createCodeMock = vi.fn().mockRejectedValue(new Error('Network unavailable'));
    render(<BrowserSetupModal onClose={() => {}} createCode={createCodeMock} />);

    const pairBtn = screen.getByRole('button', { name: 'Pair extension' });
    await user.click(pairBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
  });
});
