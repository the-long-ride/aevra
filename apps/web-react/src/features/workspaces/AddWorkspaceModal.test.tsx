import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installApiFixtures } from '../../test/api-fixtures';
import { AddWorkspaceModal } from './AddWorkspaceModal';

describe('AddWorkspaceModal', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test('closes on Escape, backdrop click, or Close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(<AddWorkspaceModal onClose={onClose} onCreated={vi.fn()} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close Add workspace' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(3);

    // Backdrop click
    const backdrop = document.querySelector('.add-workspace-backdrop')!;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(4);

    rerender(<AddWorkspaceModal onClose={onClose} onCreated={vi.fn()} />);
  });

  test('debounces directory listing, renders breadcrumbs, supports Up button and directory click', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/local/directories?path=C%3A%5CUsers%5Ctest': {
          path: 'C:\\Users\\test',
          parent: 'C:\\Users',
          directories: [
            { name: 'repo-a', path: 'C:\\Users\\test\\repo-a' },
            { name: 'repo-b', path: 'C:\\Users\\test\\repo-b' },
          ],
        },
        '/api/local/directories?path=C%3A%5CUsers': {
          path: 'C:\\Users',
          parent: 'C:\\',
          directories: [{ name: 'test', path: 'C:\\Users\\test' }],
        },
        '/api/local/directories?path=C%3A%5C': {
          path: 'C:\\',
          parent: null,
          directories: [{ name: 'Users', path: 'C:\\Users' }],
        },
        '/api/local/directories?path=C%3A%5CUsers%5Ctest%5Crepo-a': {
          path: 'C:\\Users\\test\\repo-a',
          parent: 'C:\\Users\\test',
          directories: [],
        },
      },
    });

    render(<AddWorkspaceModal onClose={vi.fn()} onCreated={vi.fn()} />);

    const pathInput = screen.getByPlaceholderText('Absolute path on the Aevra host');
    await user.type(pathInput, 'C:\\Users\\test');

    expect(await screen.findByRole('button', { name: 'repo-a' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'repo-b' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C:\\' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument();

    // Click child directory
    await user.click(screen.getByRole('button', { name: 'repo-a' }));
    expect(await screen.findByText('No child directories.')).toBeInTheDocument();

    // Click Up button
    const upButton = screen.getByRole('button', { name: 'Up' });
    expect(upButton).toBeEnabled();
    await user.click(upButton);
    expect(await screen.findByRole('button', { name: 'repo-a' })).toBeInTheDocument();

    // Click breadcrumb
    await user.click(screen.getByRole('button', { name: 'C:\\' }));
    expect(await screen.findByRole('button', { name: 'test' })).toBeInTheDocument();
  });

  test('renders posix breadcrumbs properly', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/local/directories?path=%2Fvar%2Flog': {
          path: '/var/log',
          parent: '/var',
          directories: [],
        },
      },
    });

    render(<AddWorkspaceModal onClose={vi.fn()} onCreated={vi.fn()} />);
    const pathInput = screen.getByPlaceholderText('Absolute path on the Aevra host');
    await user.type(pathInput, '/var/log');

    expect(await screen.findByRole('button', { name: '/' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'var' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'log' })).toBeInTheDocument();
  });

  test('browseOnServer populates path or displays error on failure', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/local/directories?path=%2Fselected%2Ffolder': {
          path: '/selected/folder',
          parent: '/selected',
          directories: [],
        },
      },
      mutationResponses: {
        'POST /api/local/folder-picker': new Response(
          JSON.stringify({ status: 'selected', path: '/selected/folder' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      },
    });

    render(<AddWorkspaceModal onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Browse on server' }));

    const pathInput = screen.getByPlaceholderText('Absolute path on the Aevra host');
    await waitFor(() => expect(pathInput).toHaveValue('/selected/folder'));

    // Test error case
    installApiFixtures({
      mutationResponses: {
        'POST /api/local/folder-picker': new Response(
          JSON.stringify({ error: { message: 'Picker cancelled' } }),
          { status: 500, headers: { 'content-type': 'application/json' } },
        ),
      },
    });

    await user.click(screen.getByRole('button', { name: 'Browse on server' }));
    expect(
      await screen.findByText(/Picker cancelled\. Enter or browse the server path below\./),
    ).toBeInTheDocument();
  });

  test('handles directory fetch failure gracefully', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      routes: {
        '/api/local/directories?path=invalid': new Response(
          JSON.stringify({ error: { message: 'Path not found' } }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        ),
      },
    });

    render(<AddWorkspaceModal onClose={vi.fn()} onCreated={vi.fn()} />);
    const pathInput = screen.getByPlaceholderText('Absolute path on the Aevra host');
    await user.type(pathInput, 'invalid');

    expect(await screen.findByText('Path not found')).toBeInTheDocument();
  });

  test('submits successfully and calls onCreated and onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();

    const fetchMock = installApiFixtures({
      mutationResponses: {
        'POST /api/workspaces': new Response(JSON.stringify({ id: 'ws-new' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      },
    });

    render(<AddWorkspaceModal onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Workspace name'), 'New Project');
    await user.type(screen.getByPlaceholderText('Absolute path on the Aevra host'), '/my/project');

    const submitBtn = screen.getByRole('button', { name: 'Add workspace' });
    expect(submitBtn).toBeEnabled();
    await user.click(submitBtn);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/workspaces' && init?.method === 'POST',
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        name: 'New Project',
        hostRoot: '/my/project',
      });
      expect(onCreated).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  test('handles submit error display', async () => {
    const user = userEvent.setup();
    installApiFixtures({
      mutationResponses: {
        'POST /api/workspaces': new Response(
          JSON.stringify({ error: { message: 'Workspace name duplicate' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      },
    });

    render(<AddWorkspaceModal onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText('Workspace name'), 'Duplicate Project');
    await user.type(screen.getByPlaceholderText('Absolute path on the Aevra host'), '/my/project');

    await user.click(screen.getByRole('button', { name: 'Add workspace' }));
    expect(await screen.findByText('Workspace name duplicate')).toBeInTheDocument();
  });
});
