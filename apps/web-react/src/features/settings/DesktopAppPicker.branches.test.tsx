import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { DesktopAppPicker, type DesktopAppPickerProps } from './DesktopAppPicker';
import type { AppCatalogRow } from './desktop-control-types';

function props(overrides: Partial<DesktopAppPickerProps> = {}): DesktopAppPickerProps {
  return {
    applications: [],
    apps: [],
    busy: false,
    onToggleApp: vi.fn(),
    onAddManualApp: vi.fn(),
    onSaveCustomApp: vi.fn(),
    onDeleteCustomApp: vi.fn(),
    ...overrides,
  };
}

function renderPicker(value: DesktopAppPickerProps) {
  const view = render(
    <DialogProvider>
      <DesktopAppPicker {...value} />
    </DialogProvider>,
  );
  return {
    ...view,
    rerenderPicker: (next: DesktopAppPickerProps) =>
      view.rerender(
        <DialogProvider>
          <DesktopAppPicker {...next} />
        </DialogProvider>,
      ),
  };
}

function rowFor(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('DesktopAppPicker row states', () => {
  it('marks rows without a program file as needing a manual path', () => {
    const apps: AppCatalogRow[] = [{ displayName: 'Mystery App', version: null }];
    renderPicker(props({ apps }));
    const tr = rowFor('Mystery App');
    const status = within(tr).getByText('Needs manual path');
    expect(status).toHaveClass('is-unavailable');
    expect(status).not.toHaveAttribute('title');
    expect(within(tr).getByRole('switch')).toBeDisabled();
    expect(within(tr).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('explains shared runtimes flagged by the catalog', () => {
    const apps: AppCatalogRow[] = [
      {
        displayName: 'Helper Host',
        version: '4',
        executablePath: 'C:\\H\\host.exe',
        exeBasename: 'host.exe',
        reason: 'shared-runtime',
      },
    ];
    renderPicker(props({ apps }));
    const status = within(rowFor('Helper Host')).getByText('Shared runtime');
    expect(status).toHaveAttribute(
      'title',
      'This shared process cannot identify the application that hosts its window.',
    );
    expect(status).toHaveClass('is-blocked');
  });

  it('keeps a non-grantable WebView2 runtime toggleable as a shared runtime', () => {
    const apps: AppCatalogRow[] = [
      {
        displayName: 'Runtime',
        version: null,
        executablePath: 'C:\\E\\msedgewebview2.exe',
        exeBasename: 'msedgewebview2.exe',
        grantable: false,
      },
    ];
    renderPicker(props({ apps }));
    expect(within(rowFor('Runtime')).getByRole('switch')).toBeEnabled();
    expect(within(rowFor('Runtime')).getByText('Shared runtime')).toBeInTheDocument();
  });

  it('re-renders when the allowed list changes by length or by content', () => {
    const apps: AppCatalogRow[] = [
      { displayName: 'Alpha', version: null, executablePath: 'C:\\a.exe', exeBasename: 'a.exe' },
      { displayName: 'Beta', version: null, executablePath: 'C:\\b.exe', exeBasename: 'b.exe' },
    ];
    const base = props({ apps, applications: ['a.exe'] });
    const { rerenderPicker } = renderPicker(base);
    expect(within(rowFor('Alpha')).getByText('Allowed')).toBeInTheDocument();

    rerenderPicker({ ...base, applications: ['b.exe'] });
    expect(within(rowFor('Alpha')).getByText('Blocked')).toBeInTheDocument();
    expect(within(rowFor('Beta')).getByText('Allowed')).toBeInTheDocument();

    rerenderPicker({ ...base, applications: [] });
    expect(within(rowFor('Beta')).getByText('Blocked')).toBeInTheDocument();
  });
});

describe('DesktopAppPicker custom app editing', () => {
  it('does not open the editor for a custom row without an executable path', () => {
    const apps: AppCatalogRow[] = [
      { displayName: 'Pathless', version: null, exeBasename: 'pathless.exe', isCustom: true },
    ];
    renderPicker(props({ apps }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Pathless' }));
    expect(screen.queryByRole('heading', { name: 'Edit custom app' })).toBeNull();
  });

  it('opens the editor with an empty version when the row has none', () => {
    const onSaveCustomApp = vi.fn();
    const apps: AppCatalogRow[] = [
      {
        displayName: 'Tool',
        version: null,
        executablePath: 'C:\\T\\tool.exe',
        exeBasename: 'tool.exe',
        isCustom: true,
        customAppId: 'c-tool',
      },
      { displayName: 'Loose', version: null, exeBasename: 'loose.exe' },
    ];
    renderPicker(props({ apps, onSaveCustomApp }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Tool' }));
    expect(screen.getByLabelText(/version/i)).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSaveCustomApp).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: 'C:\\T\\tool.exe', version: null }),
      'tool.exe',
      'c-tool',
    );
  });
});

describe('DesktopAppPicker manual rules', () => {
  it('ignores a blank manual entry', () => {
    const onAddManualApp = vi.fn();
    renderPicker(props({ onAddManualApp }));
    fireEvent.change(screen.getByLabelText(/add a legacy rule/i), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add app' }));
    expect(onAddManualApp).not.toHaveBeenCalled();
  });

  it('ignores keys other than Enter in the manual field', () => {
    const onAddManualApp = vi.fn();
    renderPicker(props({ onAddManualApp }));
    const field = screen.getByLabelText(/add a legacy rule/i);
    fireEvent.change(field, { target: { value: 'tool.exe' } });
    fireEvent.keyDown(field, { key: 'a' });
    expect(onAddManualApp).not.toHaveBeenCalled();
  });

  it('adds a manual WebView2 rule only after confirmation', async () => {
    const onAddManualApp = vi.fn();
    renderPicker(props({ onAddManualApp }));
    const field = screen.getByLabelText(/add a legacy rule/i);
    fireEvent.change(field, { target: { value: 'C:\\X\\msedgewebview2.exe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add app' }));
    let dialog = await screen.findByRole('dialog', { name: 'Allow WebView2 across apps?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onAddManualApp).not.toHaveBeenCalled();
    expect(field).toHaveValue('C:\\X\\msedgewebview2.exe');

    fireEvent.click(screen.getByRole('button', { name: 'Add app' }));
    dialog = await screen.findByRole('dialog', { name: 'Allow WebView2 across apps?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Allow broad WebView2 access' }));
    await waitFor(() => expect(onAddManualApp).toHaveBeenCalledWith('C:\\X\\msedgewebview2.exe'));
    expect(field).toHaveValue('');
  });
});
