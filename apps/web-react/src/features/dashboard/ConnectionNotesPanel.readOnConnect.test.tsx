import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ConnectorNote } from '@aevra/admin-contracts';
import { DialogProvider } from '../../components/Dialog';
import { installApiFixtures } from '../../test/api-fixtures';
import { ConnectionNotesPanel } from './ConnectionNotesPanel';

const BASE = '/api/connector-notes/oauth%3AChatGPT';
const HINT = 'Notes are read only when you mention them, except notes with Read on connect on.';

function note(overrides: Partial<ConnectorNote> = {}): ConnectorNote {
  return {
    id: 'n1',
    actor: 'oauth:ChatGPT',
    title: 'note-1',
    text: 'Remember the plain test phrase',
    images: [],
    visibleToAi: true,
    aiCanDelete: false,
    readOnConnect: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup(notes: ConnectorNote[], mutationResponses: Record<string, unknown> = {}) {
  const fetchMock = installApiFixtures({
    routes: { [BASE]: { actor: 'oauth:ChatGPT', notes } },
    mutationResponses,
  });
  const view = render(
    <DialogProvider>
      <ConnectionNotesPanel actor="oauth:ChatGPT" />
    </DialogProvider>,
  );
  return { fetchMock, view };
}

function body(fetchMock: ReturnType<typeof installApiFixtures>, path: string, method: string) {
  const found = fetchMock.mock.calls.find(
    ([input, init]) =>
      String(input) === path && String(init?.method ?? 'GET').toUpperCase() === method,
  );
  return found ? (JSON.parse(String(found[1]?.body ?? 'null')) as Record<string, unknown>) : null;
}

function gateMutations(failWith?: string) {
  const real = globalThis.fetch;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let mutations = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return real(input, init);
    mutations += 1;
    await gate;
    if (failWith) {
      return new Response(JSON.stringify({ error: failWith }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return real(input, init);
  }) as typeof fetch;
  return { release: open, count: () => mutations };
}

test('the connector-wide switch is gone and a short hint explains per-note reading', async () => {
  const { fetchMock, view } = setup([note()]);
  expect(await screen.findByText(HINT)).toBeInTheDocument();
  expect(screen.queryByRole('switch', { name: /Read notes when connected/ })).toBeNull();
  expect(
    view.container.querySelector('[data-surface-id="connections:notes-read-on-connect"]'),
  ).toBeNull();
  expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/settings'))).toBe(false);
});

test('the per-note Read on connect switch patches readOnConnect, optimistic and locked', async () => {
  const user = userEvent.setup();
  setup([note()], {
    [`PATCH ${BASE}/notes/n1`]: note({ readOnConnect: true }),
  });
  const toggle = await screen.findByRole('switch', { name: 'Read on connect: note-1' });
  expect(toggle).toHaveAttribute('data-surface-id', 'connections:note-read-on-connect');
  expect(toggle).not.toBeChecked();
  const gated = gateMutations();
  await user.click(toggle);
  expect(toggle).toBeChecked();
  expect(toggle).toBeDisabled();
  await user.click(toggle);
  gated.release();
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(toggle).toBeChecked();
  expect(gated.count()).toBe(1);
});

test('the per-note switch sends only readOnConnect and reverts on error', async () => {
  const user = userEvent.setup();
  const { fetchMock } = setup([note({ readOnConnect: true })], {
    [`PATCH ${BASE}/notes/n1`]: note({ readOnConnect: false }),
  });
  const toggle = await screen.findByRole('switch', { name: 'Read on connect: note-1' });
  await user.click(toggle);
  await waitFor(() =>
    expect(body(fetchMock, `${BASE}/notes/n1`, 'PATCH')).toEqual({ readOnConnect: false }),
  );
  await waitFor(() => expect(toggle).not.toBeChecked());

  const gated = gateMutations('plain failure');
  await user.click(toggle);
  expect(toggle).toBeChecked();
  gated.release();
  expect(await screen.findByText('plain failure')).toBeInTheDocument();
  await waitFor(() => expect(toggle).not.toBeChecked());
  expect(toggle).toBeEnabled();
});

test('Read on connect is disabled while the note is hidden', async () => {
  const user = userEvent.setup();
  setup([note(), note({ id: 'n2', title: 'note-2', visibleToAi: false })], {
    [`PATCH ${BASE}/notes/n1`]: note({ visibleToAi: false }),
  });
  const hidden = await screen.findByRole('switch', { name: 'Read on connect: note-2' });
  expect(hidden).toBeDisabled();
  expect(hidden.closest('[title]')).toHaveAttribute('title', "Hidden notes can't be read by AI");
  const shown = screen.getByRole('switch', { name: 'Read on connect: note-1' });
  expect(shown).toBeEnabled();
  await user.click(screen.getByRole('switch', { name: 'Visible to AI: note-1' }));
  await waitFor(() => expect(shown).toBeDisabled());
});

test('the editor sends Read on connect on create and on edit', async () => {
  const user = userEvent.setup();
  const { fetchMock } = setup([note({ readOnConnect: true })], {
    [`POST ${BASE}/notes`]: note({ id: 'n2', title: 'note-2', text: 'new words' }),
    [`PATCH ${BASE}/notes/n1`]: note({ readOnConnect: false }),
  });
  await user.click(await screen.findByRole('button', { name: 'New note' }));
  const createSwitch = screen.getByRole('switch', { name: 'Read on connect' });
  expect(createSwitch).not.toBeChecked();
  await user.type(screen.getByLabelText('Text'), 'new words');
  await user.click(createSwitch);
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(body(fetchMock, `${BASE}/notes`, 'POST')).toEqual({
      text: 'new words',
      visibleToAi: true,
      aiCanDelete: false,
      readOnConnect: true,
    }),
  );

  await user.click(await screen.findByRole('button', { name: 'Edit note-1' }));
  const editSwitch = screen.getByRole('switch', { name: 'Read on connect' });
  expect(editSwitch).toBeChecked();
  await user.click(editSwitch);
  await user.click(screen.getByRole('button', { name: 'Save note' }));
  await waitFor(() =>
    expect(body(fetchMock, `${BASE}/notes/n1`, 'PATCH')).toEqual({
      text: 'Remember the plain test phrase',
      title: 'note-1',
      keepImageIds: [],
      readOnConnect: false,
    }),
  );
});

test('the editor disables Read on connect for a hidden note', async () => {
  const user = userEvent.setup();
  setup([note({ visibleToAi: false })]);
  await user.click(await screen.findByRole('button', { name: 'Edit note-1' }));
  const editSwitch = screen.getByRole('switch', { name: 'Read on connect' });
  expect(editSwitch).toBeDisabled();
  expect(editSwitch.closest('[title]')).toHaveAttribute(
    'title',
    "Hidden notes can't be read by AI",
  );
});
