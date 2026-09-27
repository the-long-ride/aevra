import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../../services/api-client';
import { BrowserControlSettings } from './BrowserControlSettings';
import type { OriginPolicySnapshot } from './BrowserOriginPolicy';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));

const mockedRequest = vi.mocked(requestJson);

const policy: OriginPolicySnapshot = {
  loopbackClass: 'SENSITIVE',
  blockedHosts: [],
  sensitiveHosts: [],
  aevraPorts: [47830, 47831, 47832, 47833],
};
const loadPolicy = () => Promise.resolve(policy);

function pairing(id: string, name: string) {
  return {
    pairingId: id,
    profileId: id,
    profileName: name,
    extensionId: 'extension-one',
    pairedAt: '2026-09-05T10:00:00.000Z',
    connected: false,
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    pairings: [],
    extensionId: null,
    epoch: 1,
    pairedAt: null,
    pendingCode: false,
    ...overrides,
  } as any;
}

function worker(overrides: Record<string, unknown> = {}) {
  return {
    listener: { state: 'listening', port: 47833, changedAt: '2026-09-25T00:00:00Z' },
    extensionSocketAuthenticated: false,
    connected: false,
    ...overrides,
  };
}

function healthText(health: Record<string, unknown>, pairings: unknown[] = []) {
  const { unmount } = render(
    <BrowserControlSettings
      status={state({ health, pairings })}
      onChanged={vi.fn()}
      loadPolicy={loadPolicy}
    />,
  );
  const text = document.querySelector('p.section-note[role="status"]')?.textContent ?? '';
  unmount();
  return text;
}

beforeEach(() => {
  mockedRequest.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BrowserControlSettings health text', () => {
  it('uses the default listener error code', () => {
    expect(
      healthText({ worker: worker({ listener: { state: 'failed', port: 47833 } }) }),
    ).toContain('Listener failed on port 47833: BROWSER_LISTENER_FAILED.');
  });

  it('reports a missing worker with and without a sync code', () => {
    expect(healthText({})).toContain('Worker unavailable: WORKER_UNAVAILABLE.');
    expect(healthText({ syncErrorCode: 'SYNC_TIMEOUT' })).toContain(
      'Worker unavailable: SYNC_TIMEOUT.',
    );
  });

  it('reports a pairing sync problem when the worker is present', () => {
    expect(healthText({ worker: worker(), syncErrorCode: 'EPOCH_MISMATCH' })).toContain(
      'Pairing sync needs attention: EPOCH_MISMATCH.',
    );
  });

  it('describes authenticated sockets with and without a profile name', () => {
    const attached = healthText({
      worker: worker({ extensionSocketAuthenticated: true, connected: true, activeProfileName: 'Work' }),
    });
    expect(attached).toContain('Extension socket authenticated for Work');
    expect(attached).toContain(' - Browser attached');
    const detached = healthText({ worker: worker({ extensionSocketAuthenticated: true }) });
    expect(detached).toMatch(/^Extension socket authenticated - Browser not attached/);
  });

  it('distinguishes waiting pairings from having no socket at all', () => {
    expect(healthText({ worker: worker() }, [pairing('p1', 'One')])).toContain(
      'Waiting for a paired profile to authenticate.',
    );
    expect(healthText({ worker: worker() })).toBe(
      'No extension socket authenticated - No browser attached',
    );
  });
});

describe('BrowserControlSettings default actions', () => {
  it('pluralises the paired profile count', () => {
    render(
      <BrowserControlSettings
        status={state({ pairings: [pairing('p1', 'One'), pairing('p2', 'Two')] })}
        onChanged={vi.fn()}
        loadPolicy={loadPolicy}
      />,
    );
    expect(screen.getByText('2 browser profiles paired')).toBeInTheDocument();
  });

  it('creates a pairing code and revokes all through the default endpoints', async () => {
    mockedRequest.mockImplementation((async (url: string) =>
      url === '/api/browser/code'
        ? { code: 'pair-words', expiresAt: '2026-09-05T10:05:00.000Z' }
        : state()) as never);
    const onChanged = vi.fn();
    render(<BrowserControlSettings status={state()} onChanged={onChanged} loadPolicy={loadPolicy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pair extension' }));
    expect(await screen.findByText('pair-words')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect all browsers' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(mockedRequest).toHaveBeenCalledWith('/api/browser/revoke', {
      method: 'POST',
      body: '{}',
    });
  });

  it('stringifies a non-Error action failure', async () => {
    mockedRequest.mockRejectedValueOnce('code service down');
    render(<BrowserControlSettings status={state()} onChanged={vi.fn()} loadPolicy={loadPolicy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pair extension' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('code service down');
  });

  it('unpairs through the default endpoint and reports non-Error failures', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onChanged = vi.fn();
    render(
      <BrowserControlSettings
        status={state({ pairings: [pairing('p 1', 'One')] })}
        onChanged={onChanged}
        loadPolicy={loadPolicy}
      />,
    );
    mockedRequest.mockResolvedValueOnce(state() as never);
    fireEvent.click(screen.getByRole('button', { name: /^Unpair/ }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockedRequest).toHaveBeenCalledWith('/api/browser/pairings/p%201', { method: 'DELETE' });

    mockedRequest.mockRejectedValueOnce('sync pending');
    fireEvent.click(screen.getByRole('button', { name: /^Unpair/ }));
    expect(await screen.findByText('Unpair request needs attention: sync pending')).toBeInTheDocument();
    expect(screen.getByText('sync pending')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });
});
