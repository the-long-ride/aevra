import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BrowserOriginPolicy, type OriginPolicySnapshot } from './BrowserOriginPolicy';

const snapshot: OriginPolicySnapshot = {
  loopbackClass: 'SENSITIVE',
  blockedHosts: ['intranet.example.com'],
  sensitiveHosts: [],
  aevraPorts: [47830, 47831, 47832, 47833],
};

function mount(overrides: Partial<OriginPolicySnapshot> = {}) {
  const value = { ...snapshot, ...overrides };
  const save = vi.fn().mockImplementation(async (next: Partial<OriginPolicySnapshot>) => ({
    ...value,
    ...next,
  }));
  render(<BrowserOriginPolicy load={() => Promise.resolve(value)} save={save} />);
  return { save };
}

describe('BrowserOriginPolicy', () => {
  it('shows the stored loopback choice as the selected one', async () => {
    mount();
    const chosen = await screen.findByRole('radio', { name: /ask every time/i });
    expect((chosen as HTMLInputElement).checked).toBe(true);
  });

  it('states the Aevra ports as a fact, not a control', async () => {
    mount();
    await screen.findByRole('radio', { name: /refuse/i });
    expect(screen.getByText(/47831/)).toBeTruthy();
    expect(screen.getByText(/always refused/i)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /port/i })).toBeNull();
  });

  it('saves the loopback class the operator picked', async () => {
    const { save } = mount();
    const allow = await screen.findByRole('radio', { name: /allow/i });
    fireEvent.click(allow);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ loopbackClass: 'NORMAL' })),
    );
  });

  it('splits a host list on commas and whitespace alike', async () => {
    const { save } = mount();
    const blocked = await screen.findByLabelText(/always refuse these hosts/i);
    fireEvent.change(blocked, { target: { value: 'a.example.com, b.example.com  c.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /save host lists/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          blockedHosts: ['a.example.com', 'b.example.com', 'c.example.com'],
        }),
      ),
    );
  });

  it('surfaces a refused save instead of reporting success', async () => {
    const save = vi.fn().mockRejectedValue(new Error('ORIGIN_POLICY_INVALID'));
    render(<BrowserOriginPolicy load={() => Promise.resolve(snapshot)} save={save} />);
    fireEvent.click(await screen.findByRole('button', { name: /save host lists/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('ORIGIN_POLICY_INVALID'),
    );
    expect(screen.queryByText(/origin policy saved/i)).toBeNull();
  });

  it('renders nothing but the error when the policy cannot be loaded', async () => {
    render(
      <BrowserOriginPolicy
        load={() => Promise.reject(new Error('BROWSER_UNAVAILABLE'))}
        save={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('BROWSER_UNAVAILABLE'),
    );
    expect(screen.queryByRole('radio')).toBeNull();
  });
});
