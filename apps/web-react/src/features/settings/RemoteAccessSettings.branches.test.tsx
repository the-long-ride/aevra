import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../../services/api-client';
import { RemoteAccessSettings } from './RemoteAccessSettings';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));

const mockedRequest = vi.mocked(requestJson);

function status(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'local',
    state: 'ready',
    localGatewayUrl: 'https://127.0.0.1:47830',
    publicUrl: 'https://127.0.0.1:47830',
    oauth: { issuer: 'https://127.0.0.1:47830', resource: 'https://127.0.0.1:47830/mcp' },
    ...overrides,
  } as any;
}

function renderSettings(overrides: Record<string, unknown> = {}) {
  const onChanged = vi.fn(async () => undefined);
  render(<RemoteAccessSettings status={status(overrides)} onChanged={onChanged} />);
  return { onChanged };
}

function bodyOf(path: string) {
  const call = mockedRequest.mock.calls.filter(([url]) => url === path).at(-1);
  expect(call, `expected a request to ${path}`).toBeTruthy();
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

function submit() {
  fireEvent.submit(document.querySelector('form.remote-config') as HTMLFormElement);
}

function adminProbeText() {
  return document.querySelector('.remote-admin-probe')?.textContent ?? '';
}

beforeEach(() => {
  mockedRequest.mockReset();
  mockedRequest.mockResolvedValue({} as never);
});

afterEach(() => {
  mockedRequest.mockReset();
});

describe('RemoteAccessSettings branches', () => {
  it('omits blank Cloudflare Access fields from the saved config', async () => {
    const { onChanged } = renderSettings({
      provider: 'cloudflare',
      config: { provider: 'cloudflare', cloudflare: { authMode: 'access', ownership: 'external' } },
    });
    submit();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = bodyOf('/api/exposure/config');
    expect(body.publicUrl).toBeUndefined();
    expect(body.cloudflare).toEqual({ ownership: 'external', authMode: 'access' });
    expect(screen.getByText('Exposure configured: cloudflare.')).toBeInTheDocument();
  });

  it('trims Cloudflare Access issuer and audience when provided', async () => {
    const { onChanged } = renderSettings({
      provider: 'cloudflare',
      config: {
        provider: 'cloudflare',
        cloudflare: {
          authMode: 'access',
          hostname: 'aevra.example.com',
          tunnelId: 'tunnel-one',
          issuer: 'https://team.example.com',
          audience: 'aud-one',
        },
      },
    });
    submit();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const body = bodyOf('/api/exposure/config');
    expect(body.publicUrl).toBe('https://aevra.example.com');
    expect(body.cloudflare).toMatchObject({
      hostname: 'aevra.example.com',
      tunnelId: 'tunnel-one',
      issuer: 'https://team.example.com',
      audience: 'aud-one',
      ownership: 'managed',
    });
  });

  it('shows a stringified save failure', async () => {
    mockedRequest.mockRejectedValueOnce('config rejected');
    const { onChanged } = renderSettings();
    submit();
    expect(await screen.findByText('config rejected')).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('falls back to a default Cloudflare authentication message', async () => {
    const { onChanged } = renderSettings({ provider: 'cloudflare' });
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate Cloudflare' }));
    expect(await screen.findByText('Cloudflare authentication completed.')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows Cloudflare authentication failures for Error and non-Error values', async () => {
    renderSettings({ provider: 'cloudflare' });
    mockedRequest.mockRejectedValueOnce(new Error('login window closed'));
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate Cloudflare' }));
    expect(await screen.findByText('login window closed')).toBeInTheDocument();
    mockedRequest.mockRejectedValueOnce('cloudflared missing');
    fireEvent.click(screen.getByRole('button', { name: 'Authenticate Cloudflare' }));
    expect(await screen.findByText('cloudflared missing')).toBeInTheDocument();
  });

  it('probes the admin URL and reports each reachability outcome', async () => {
    renderSettings();
    const test = screen.getByRole('button', { name: 'Test Admin URL' });

    mockedRequest.mockResolvedValueOnce({ reachable: true, trusted: false } as never);
    fireEvent.click(test);
    await waitFor(() => expect(adminProbeText()).toMatch(/Not trusted/));
    expect(bodyOf('/api/exposure/admin/test')).toEqual({ trustedOrigins: [] });

    mockedRequest.mockResolvedValueOnce({ reachable: false, trusted: false } as never);
    fireEvent.click(test);
    await waitFor(() => expect(adminProbeText()).toBe('Admin endpoint is not reachable'));

    mockedRequest.mockResolvedValueOnce({
      reachable: false,
      trusted: false,
      message: 'TLS handshake failed',
    } as never);
    fireEvent.click(test);
    await waitFor(() => expect(adminProbeText()).toBe('TLS handshake failed'));

    mockedRequest.mockRejectedValueOnce(new Error('probe crashed'));
    fireEvent.click(test);
    await waitFor(() => expect(adminProbeText()).toBe('probe crashed'));

    mockedRequest.mockRejectedValueOnce('probe offline');
    fireEvent.click(test);
    await waitFor(() => expect(adminProbeText()).toBe('probe offline'));
    expect(document.querySelector('.remote-admin-probe')).toHaveClass('error');
  });

  it('ignores blank, primary and duplicate trusted origins', () => {
    renderSettings();
    const input = screen.getByLabelText('New trusted Admin origin') as HTMLInputElement;
    const add = screen.getByRole('button', { name: 'Add trusted origin' });

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.click(add);
    expect(input.value).toBe('   ');
    expect(screen.getByRole('button', { name: /View all trusted origins \(0\)/ })).toBeDisabled();

    fireEvent.change(input, { target: { value: 'https://admin.example.com/path' } });
    fireEvent.click(add);
    fireEvent.change(input, { target: { value: 'https://admin.example.com' } });
    fireEvent.click(add);
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: /View all trusted origins \(1\)/ })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('Admin public URL'), {
      target: { value: 'https://ui.example.com/app' },
    });
    fireEvent.change(input, { target: { value: 'https://ui.example.com' } });
    fireEvent.click(add);
    expect(input.value).toBe('');
    expect(
      screen.getByRole('button', { name: /View all trusted origins \(1\)/ }),
    ).toBeInTheDocument();
  });
});
