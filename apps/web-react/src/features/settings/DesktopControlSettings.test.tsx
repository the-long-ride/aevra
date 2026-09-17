import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DesktopControlSettings, type DesktopPolicySnapshot, type DetectedApp } from './DesktopControlSettings';

const policy: DesktopPolicySnapshot = {
  mode: 'denylist',
  applications: [],
  unattributedInput: 'deny',
};

const apps: DetectedApp[] = [
  {
    displayName: 'Notepad Replacement',
    version: '2.3.1',
    executablePath: 'C:\\Program Files\\NotepadReplacement\\np.exe',
    exeBasename: 'np.exe',
  },
];

function mount(overrides: Partial<DesktopPolicySnapshot> = {}) {
  const value = { ...policy, ...overrides };
  const save = vi.fn().mockImplementation(async (next) => ({ ...value, ...next }));
  render(
    <DesktopControlSettings
      load={() => Promise.resolve(value)}
      save={save}
      loadApps={() => Promise.resolve(apps)}
    />,
  );
  return { save };
}

describe('DesktopControlSettings', () => {
  it('shows the allow-all mode by default', async () => {
    mount();
    const allowAll = await screen.findByRole('radio', { name: /allow all apps/i });
    expect((allowAll as HTMLInputElement).checked).toBe(true);
  });

  it('switching to allowlist mode saves the new mode', async () => {
    const { save } = mount();
    const onlyThese = await screen.findByRole('radio', { name: /only these apps/i });
    fireEvent.click(onlyThese);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ mode: 'allowlist' })),
    );
  });

  it('shows the detected app list once allowlist mode is active', async () => {
    mount({ mode: 'allowlist', applications: [] });
    expect(await screen.findByText(/notepad replacement/i)).toBeTruthy();
    expect(screen.getByText(/2\.3\.1/)).toBeTruthy();
  });

  it('checking a detected app adds its exe basename to applications', async () => {
    const { save } = mount({ mode: 'allowlist', applications: [] });
    const checkbox = await screen.findByRole('checkbox', { name: /notepad replacement/i });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ applications: ['np.exe'] })),
    );
  });

  it('matches an allowlist entry that differs only in case', async () => {
    // The gate and desktop_apps both lowercase before matching, so an
    // exact-case check here would show this app as unchecked AND repeat it as
    // a second "not detected" row - one app, two contradictory rows.
    mount({ mode: 'allowlist', applications: ['NP.EXE'] });
    const checkbox = (await screen.findByRole('checkbox', {
      name: /notepad replacement/i,
    })) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByText('NP.EXE')).toBeNull();
  });

  it('unchecking an allowlist entry that differs only in case removes it', async () => {
    const { save } = mount({ mode: 'allowlist', applications: ['NP.EXE'] });
    const checkbox = await screen.findByRole('checkbox', { name: /notepad replacement/i });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ applications: [] })),
    );
  });

  it('an app missing from detection can be added by hand', async () => {
    // Detection cannot see apps that register only an installer, so the
    // operator needs a way to name the process the gate will actually match.
    const { save } = mount({ mode: 'allowlist', applications: [] });
    const field = await screen.findByLabelText(/add an app by program file name/i);
    fireEvent.change(field, { target: { value: 'Docker Desktop.exe' } });
    fireEvent.click(screen.getByRole('button', { name: /add app/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ applications: ['Docker Desktop.exe'] }),
      ),
    );
  });

  it('adding an app that is already allowed does not duplicate it', async () => {
    const { save } = mount({ mode: 'allowlist', applications: ['np.exe'] });
    const field = await screen.findByLabelText(/add an app by program file name/i);
    fireEvent.change(field, { target: { value: 'NP.EXE' } });
    fireEvent.click(screen.getByRole('button', { name: /add app/i }));
    await waitFor(() => expect(save).not.toHaveBeenCalled());
  });

  it('warns that switching mode clears the list', async () => {
    mount();
    expect(await screen.findByText(/switching mode clears the list/i)).toBeTruthy();
  });

  it('toggling the path-exposure checkbox saves exposeExecutablePaths', async () => {
    const { save } = mount();
    const pathsCheckbox = await screen.findByRole('checkbox', { name: /show file paths/i });
    fireEvent.click(pathsCheckbox);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ exposeExecutablePaths: true })),
    );
  });
});
