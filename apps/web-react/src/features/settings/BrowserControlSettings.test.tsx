import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserControlSettings } from './BrowserControlSettings';
import type { OriginPolicySnapshot } from './BrowserOriginPolicy';

const unpaired = { extensionId: null, epoch: 1, pairedAt: null, pendingCode: false };
const paired = {
  extensionId: 'abcdefghijklmnopabcdefghijklmnop',
  epoch: 1,
  pairedAt: '2026-09-05T10:00:00.000Z',
  pendingCode: false,
};

const policy: OriginPolicySnapshot = {
  loopbackClass: 'SENSITIVE',
  blockedHosts: [],
  sensitiveHosts: [],
  aevraPorts: [47830, 47831, 47832, 47833],
};
// The panel embeds the origin policy editor, which loads over the admin API.
// Every render here stubs that load so these cases stay about pairing.
const loadPolicy = () => Promise.resolve(policy);

describe('BrowserControlSettings', () => {
  it('reports when no extension is paired', () => {
    render(
      <BrowserControlSettings status={unpaired} onChanged={vi.fn()} loadPolicy={loadPolicy} />,
    );
    expect(screen.getByText(/no extension paired/i)).toBeTruthy();
  });

  it('shows the paired extension id', () => {
    render(<BrowserControlSettings status={paired} onChanged={vi.fn()} loadPolicy={loadPolicy} />);
    expect(screen.getByText(/abcdefghijklmnopabcdefghijklmnop/)).toBeTruthy();
  });

  it('renders the pairing code returned by the server', async () => {
    const onChanged = vi.fn();
    const createCode = vi.fn().mockResolvedValue({ code: 'ABCDEFGH', expiresAt: 'soon' });
    render(
      <BrowserControlSettings
        status={unpaired}
        onChanged={onChanged}
        createCode={createCode}
        loadPolicy={loadPolicy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pair extension/i }));
    await waitFor(() => expect(screen.getByText('ABCDEFGH')).toBeTruthy());
  });

  it('disconnects every browser and refreshes', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    const revokeAll = vi.fn().mockResolvedValue({ ...unpaired, epoch: 2 });
    render(
      <BrowserControlSettings
        status={paired}
        onChanged={onChanged}
        revokeAll={revokeAll}
        loadPolicy={loadPolicy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /disconnect all browsers/i }));
    await waitFor(() => expect(revokeAll).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a failure instead of silently doing nothing', async () => {
    const revokeAll = vi.fn().mockRejectedValue(new Error('worker unavailable'));
    render(
      <BrowserControlSettings
        status={paired}
        onChanged={vi.fn()}
        revokeAll={revokeAll}
        loadPolicy={loadPolicy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /disconnect all browsers/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('worker unavailable'),
    );
  });

  it('renders only the pairing code, never a token the server sent alongside it', async () => {
    // Asserting on the word "token" would only pin the explanatory copy. What
    // matters is that a token value never reaches the page.
    const createCode = vi.fn().mockResolvedValue({
      code: 'ABCDEFGH',
      expiresAt: 'soon',
      token: 'must-not-be-rendered',
    });
    const { container } = render(
      <BrowserControlSettings
        status={paired}
        onChanged={vi.fn()}
        createCode={createCode}
        loadPolicy={loadPolicy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /pair extension/i }));
    await waitFor(() => expect(screen.getByText('ABCDEFGH')).toBeTruthy());
    expect(container.textContent).not.toContain('must-not-be-rendered');
  });
});
