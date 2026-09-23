import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { DesktopControlSettings } from './DesktopControlSettings';
import {
  apps,
  configureDesktopApiMock,
  customApp,
  mount,
  policy,
  requestJsonMock,
  resetDesktopControlTestState,
} from './DesktopControlSettings.test-support';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));
describe('DesktopControlSettings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDesktopControlTestState();
    configureDesktopApiMock();
  });

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

  it('shows readable labels for each app discovery source', async () => {
    mount({ mode: 'allowlist', applications: [] }, [
      customApp({
        displayName: 'Catalog app',
        version: null,
        executablePath: 'C:\\Apps\\catalog.exe',
        exeBasename: 'catalog.exe',
        sources: ['registry', 'start-menu', 'running', 'packaged', 'custom', 'portable'],
        isCustom: false,
      }),
    ]);

    expect(
      await screen.findByText(
        'Registry, Start Menu, Running app, Packaged app, Custom app, portable',
      ),
    ).toBeInTheDocument();
  });

  it('checking a detected app creates a path-specific grant', async () => {
    const { save } = mount({ mode: 'allowlist', applications: [] });
    const checkbox = await screen.findByRole('switch', { name: /notepad replacement/i });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/desktop/app-grants',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            executablePath: apps[0]!.executablePath,
            displayName: 'Notepad Replacement',
          }),
        }),
      ),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it('matches an allowlist entry that differs only in case', async () => {
    // The gate and desktop_apps both lowercase before matching, so an
    // exact-case check here would show this app as unchecked AND repeat it as
    // a second "not detected" row - one app, two contradictory rows.
    mount({ mode: 'allowlist', applications: ['NP.EXE'] });
    const checkbox = (await screen.findByRole('switch', {
      name: /notepad replacement/i,
    })) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByText('NP.EXE')).toBeNull();
  });

  it('unchecking an allowlist entry that differs only in case removes it', async () => {
    const { save } = mount({ mode: 'allowlist', applications: ['NP.EXE'] });
    const checkbox = await screen.findByRole('switch', { name: /notepad replacement/i });
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ applications: [] })),
    );
  });

  it('an app missing from detection can be added by hand', async () => {
    // Detection cannot see apps that register only an installer, so the
    // operator needs a way to name the process the gate will actually match.
    const { save } = mount({ mode: 'allowlist', applications: [] });
    const field = await screen.findByLabelText(/add a legacy rule by program file name/i);
    fireEvent.change(field, { target: { value: 'Docker Desktop.exe' } });
    fireEvent.click(screen.getByRole('button', { name: /add app/i }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ applications: ['Docker Desktop.exe'] }),
      ),
    );
  });

  it('adds an app by pressing Enter in manual input', async () => {
    const { save } = mount({ mode: 'allowlist', applications: [] });
    const field = await screen.findByLabelText(/add a legacy rule by program file name/i);
    fireEvent.change(field, { target: { value: 'Code.exe' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ applications: ['Code.exe'] })),
    );
  });

  it('adding an app that is already allowed does not duplicate it', async () => {
    const { save } = mount({ mode: 'allowlist', applications: ['np.exe'] });
    const field = await screen.findByLabelText(/add a legacy rule by program file name/i);
    fireEvent.change(field, { target: { value: 'NP.EXE' } });
    fireEvent.click(screen.getByRole('button', { name: /add app/i }));
    await waitFor(() => expect(save).not.toHaveBeenCalled());
  });

  it('warns that switching mode clears the list', async () => {
    mount();
    expect(await screen.findByText(/switching mode clears the list/i)).toBeTruthy();
  });

  it('toggling the path-exposure checkbox saves exposeExecutablePaths and displays a toast', async () => {
    const { save } = mount();
    const pathsCheckbox = await screen.findByRole('switch', { name: /show file paths/i });
    fireEvent.click(pathsCheckbox);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ exposeExecutablePaths: true })),
    );
    const toast = await screen.findByRole('status');
    expect(toast).toHaveClass('toast', 'success');
    expect(toast).toHaveTextContent('// Desktop policy saved.');
  });

  it('toggling path exposure preserves app table search input state', async () => {
    mount({ mode: 'allowlist', applications: [] });
    const searchInput = (await screen.findByPlaceholderText('Search apps…')) as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'notepad' } });
    expect(searchInput.value).toBe('notepad');

    const pathsCheckbox = await screen.findByRole('switch', { name: /show file paths/i });
    fireEvent.click(pathsCheckbox);

    await waitFor(() => {
      expect(searchInput.value).toBe('notepad');
    });
  });

  it('opens custom app modal and adds app with file path and optional version', async () => {
    const { save } = mount({ mode: 'allowlist', applications: [] });
    const modalTrigger = await screen.findByRole('button', {
      name: /\+ add custom app with path/i,
    });
    fireEvent.click(modalTrigger);

    expect(await screen.findByRole('heading', { name: 'Add custom app' })).toBeInTheDocument();

    const pathInput = screen.getByLabelText(/program file path/i);
    const nameInput = screen.getByLabelText(/application name/i);
    const versionInput = screen.getByLabelText(/version/i);

    fireEvent.change(pathInput, {
      target: { value: 'C:\\Users\\User\\AppData\\Local\\Programs\\CustomTool.exe' },
    });
    fireEvent.change(nameInput, { target: { value: 'Custom Tool' } });
    fireEvent.change(versionInput, { target: { value: '3.1.0' } });

    fireEvent.click(screen.getByRole('button', { name: /add application/i }));

    await waitFor(() =>
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/desktop/custom-apps',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            executablePath: 'C:\\Users\\User\\AppData\\Local\\Programs\\CustomTool.exe',
            displayName: 'Custom Tool',
            version: '3.1.0',
          }),
        }),
      ),
    );
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText('Custom Tool')).toBeInTheDocument();
    expect(screen.getByText(/3\.1\.0/)).toBeInTheDocument();
  });

  it('custom app modal works with version omitted', async () => {
    const { save } = mount({ mode: 'allowlist', applications: [] });
    fireEvent.click(
      await screen.findByRole('button', {
        name: /\+ add custom app with path/i,
      }),
    );

    const pathInput = await screen.findByLabelText(/program file path/i);
    fireEvent.change(pathInput, { target: { value: 'C:\\Tools\\my-cli.exe' } });
    fireEvent.change(screen.getByLabelText(/application name/i), { target: { value: 'my-cli' } });

    fireEvent.click(screen.getByRole('button', { name: /add application/i }));

    await waitFor(() =>
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/desktop/custom-apps',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            executablePath: 'C:\\Tools\\my-cli.exe',
            displayName: 'my-cli',
            version: null,
          }),
        }),
      ),
    );
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText('my-cli')).toBeInTheDocument();
  });

  it('allows editing a custom application using the modal', async () => {
    const { save } = mount({ mode: 'allowlist', applications: [] }, [customApp()]);

    expect(await screen.findByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
    const editBtn = await screen.findByRole('button', { name: /edit old tool/i });
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);

    expect(await screen.findByRole('heading', { name: 'Edit custom app' })).toBeInTheDocument();
    const pathInput = screen.getByLabelText(/program file path/i);
    const nameInput = screen.getByLabelText(/application name/i);
    const versionInput = screen.getByLabelText(/version/i);

    expect(pathInput).toHaveValue('C:\\Tools\\OldTool.exe');
    expect(nameInput).toHaveValue('Old Tool');
    expect(versionInput).toHaveValue('1.0.0');

    fireEvent.change(pathInput, { target: { value: 'C:\\Tools\\NewTool.exe' } });
    fireEvent.change(nameInput, { target: { value: 'New Tool' } });
    fireEvent.change(versionInput, { target: { value: '2.0.0' } });

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/desktop/custom-apps',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            id: 'custom-old-tool',
            executablePath: 'C:\\Tools\\NewTool.exe',
            displayName: 'New Tool',
            version: '2.0.0',
          }),
        }),
      ),
    );
    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByText('New Tool')).toBeInTheDocument();
  });

  it('allows deleting a custom application record', async () => {
    const user = userEvent.setup();
    const { save } = mount({ mode: 'allowlist', applications: [] }, [
      customApp({
        displayName: 'To Delete',
        version: null,
        executablePath: 'C:\\Tools\\ToDelete.exe',
        exeBasename: 'ToDelete.exe',
        customAppId: 'custom-delete',
      }),
    ]);

    const deleteBtn = await screen.findByRole('button', { name: /delete to delete/i });
    expect(deleteBtn).toBeInTheDocument();

    await user.click(deleteBtn);
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete custom app' });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(requestJsonMock).toHaveBeenCalledWith(
        '/api/desktop/custom-apps/custom-delete',
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByText('To Delete')).toBeNull();
  });

  it('cancelling custom app delete retains the app', async () => {
    const user = userEvent.setup();
    const { save } = mount({ mode: 'allowlist', applications: [] }, [
      customApp({
        displayName: 'To Keep',
        version: null,
        executablePath: 'C:\\Tools\\ToKeep.exe',
        exeBasename: 'ToKeep.exe',
        customAppId: 'custom-keep',
      }),
    ]);
    const deleteBtn = await screen.findByRole('button', { name: /delete to keep/i });
    await user.click(deleteBtn);
    const deleteDialog = screen.getByRole('dialog', { name: 'Delete custom app' });
    await user.click(within(deleteDialog).getByRole('button', { name: 'Cancel' }));

    expect(save).not.toHaveBeenCalled();
    expect(requestJsonMock).not.toHaveBeenCalledWith(
      '/api/desktop/custom-apps/custom-keep',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(screen.getByText('To Keep')).toBeInTheDocument();
  });

  it('displays error when save fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Failed to update policy'));
    render(
      <DialogProvider>
        <DesktopControlSettings
          load={() => Promise.resolve(policy)}
          save={save}
          loadApps={() => Promise.resolve(apps)}
        />
      </DialogProvider>,
    );
    const onlyThese = await screen.findByRole('radio', { name: /only these apps/i });
    fireEvent.click(onlyThese);
    expect(await screen.findByText('Failed to update policy')).toBeInTheDocument();
  });

  it('displays error when initial load fails', async () => {
    render(
      <DialogProvider>
        <DesktopControlSettings
          load={() => Promise.reject(new Error('Cannot load policy'))}
          save={vi.fn()}
          loadApps={() => Promise.resolve([])}
        />
      </DialogProvider>,
    );
    expect(await screen.findByText('Cannot load policy')).toBeInTheDocument();
  });

  it('gracefully handles malformed JSON in custom apps storage', () => {
    window.localStorage.setItem('aevra.custom_desktop_apps', 'invalid-json{');
    mount({ mode: 'allowlist', applications: [] });
    expect(screen.getByRole('heading', { name: 'Desktop control' })).toBeInTheDocument();
  });
});
