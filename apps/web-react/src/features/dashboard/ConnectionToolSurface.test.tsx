import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectionToolSurface } from './ConnectionToolSurface';

const fetchConnectorProfiles = vi.fn();
const saveConnectorProfile = vi.fn();
vi.mock('../../services/connector-profile-service', () => ({
  fetchConnectorProfiles: () => fetchConnectorProfiles(),
  saveConnectorProfile: (...args: unknown[]) => saveConnectorProfile(...args),
}));

const GROUPS = [
  'files',
  'commands',
  'git',
  'changes',
  'skills',
  'browser',
  'desktop',
  'control',
  'upstream',
];
const response = (profile = {}) => ({
  groups: GROUPS,
  groupTokens: {
    core: 3200,
    files: 1700,
    commands: 3000,
    git: 900,
    changes: 350,
    skills: 600,
    browser: 2500,
    desktop: 2200,
    control: 650,
    upstream: 0,
  },
  entries: [{ actor: 'oauth:Beta', label: 'Beta', kind: 'oauth', profile }],
});

beforeEach(() => {
  fetchConnectorProfiles.mockReset().mockResolvedValue(response());
  saveConnectorProfile
    .mockReset()
    .mockImplementation(async (actor, profile) => ({ actor, profile }));
});

describe('ConnectionToolSurface', () => {
  it('lists every group with its token estimate; core is fixed on', async () => {
    render(<ConnectionToolSurface actor="oauth:Beta" />);
    expect(await screen.findByRole('checkbox', { name: /browser/i })).toBeChecked();
    expect(screen.getByText(/2\.5k tokens/)).toBeInTheDocument();
    const core = screen.getByRole('checkbox', { name: /core/i });
    expect(core).toBeChecked();
    expect(core).toBeDisabled();
  });

  it('reflects a saved profile', async () => {
    fetchConnectorProfiles.mockResolvedValue(
      response({ toolGroups: ['files'], resultFormat: 'text' }),
    );
    render(<ConnectionToolSurface actor="oauth:Beta" />);
    expect(await screen.findByRole('checkbox', { name: /files/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /browser/i })).not.toBeChecked();
  });

  it('saves the chosen groups and tells the user when it applies', async () => {
    render(<ConnectionToolSurface actor="oauth:Beta" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /browser/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /desktop/i }));
    await userEvent.click(screen.getByRole('button', { name: /save tool surface/i }));
    await waitFor(() => expect(saveConnectorProfile).toHaveBeenCalledTimes(1));
    const [actor, profile] = saveConnectorProfile.mock.calls[0]!;
    expect(actor).toBe('oauth:Beta');
    expect(profile.toolGroups).toEqual(GROUPS.filter((g) => g !== 'browser' && g !== 'desktop'));
    expect(
      await screen.findByText(/applies the next time this client lists tools/i),
    ).toBeInTheDocument();
  });

  it('shows the estimated saving for the groups switched off', async () => {
    render(<ConnectionToolSurface actor="oauth:Beta" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /browser/i }));
    expect(screen.getByText(/saves about 2\.5k tokens/i)).toBeInTheDocument();
  });

  it('shows an error when saving fails', async () => {
    saveConnectorProfile.mockRejectedValue(new Error('nope'));
    render(<ConnectionToolSurface actor="oauth:Beta" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /git/i }));
    await userEvent.click(screen.getByRole('button', { name: /save tool surface/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i);
  });
});
