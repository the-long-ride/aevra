import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { DialogProvider } from '../../components/Dialog';
import { McpActivityPanel } from './McpActivityPanel';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener as (event: MessageEvent<string>) => void);
    this.listeners.set(type, listeners);
  }

  emit(type: string, value: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(value) } as MessageEvent<string>);
    }
  }

  close() {
    this.closed = true;
  }
}

const originalEventSource = globalThis.EventSource;

afterEach(() => {
  FakeEventSource.instances.length = 0;
  if (originalEventSource) globalThis.EventSource = originalEventSource;
  else delete (globalThis as { EventSource?: typeof EventSource }).EventSource;
});

function activity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op_1',
    startedAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    actor: 'oauth:ChatGPT',
    sessionId: 'ses_1',
    workspaceId: 'ws_1',
    kind: 'tool',
    action: 'file_read',
    state: 'running',
    ...overrides,
  };
}

function renderPanel(workspaces = [{ id: 'ws_1', name: 'Aevra' }]) {
  return render(
    <DialogProvider>
      <McpActivityPanel workspaces={workspaces} />
    </DialogProvider>,
  );
}

test('live MCP activity merges lifecycle updates by operation id', () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  renderPanel();

  const source = FakeEventSource.instances[0]!;
  expect(source.url).toBe('/api/activity/stream');
  act(() => source.onopen?.());
  act(() => source.emit('activity', activity()));

  const table = screen.getByRole('table');
  expect(within(table).getByText('RUNNING')).toBeInTheDocument();
  expect(within(table).getByText('ChatGPT')).toBeInTheDocument();
  expect(within(table).getByText('Aevra')).toBeInTheDocument();

  act(() =>
    source.emit(
      'activity',
      activity({
        updatedAt: '2026-08-20T00:00:00.012Z',
        state: 'success',
        durationMs: 12,
      }),
    ),
  );

  expect(within(table).queryByText('RUNNING')).not.toBeInTheDocument();
  expect(within(table).getByText('SUCCESS')).toBeInTheDocument();
  expect(within(table).getByText('12 ms')).toBeInTheDocument();
  expect(within(table).getAllByText('file_read')).toHaveLength(1);
});

test('live MCP activity shows newest records first with pagination', () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  renderPanel();
  const source = FakeEventSource.instances[0]!;

  act(() => {
    for (let index = 1; index <= 12; index += 1) {
      source.emit(
        'activity',
        activity({
          id: `op_${index}`,
          updatedAt: `2026-08-20T00:00:${String(index).padStart(2, '0')}.000Z`,
          action: `action_${index}`,
          state: 'success',
          durationMs: index,
        }),
      );
    }
  });

  expect(screen.getByText('1–10 of 12')).toBeInTheDocument();
  expect(screen.getByText('Page 1 / 2')).toBeInTheDocument();
  const rows = screen.getAllByRole('row');
  expect(within(rows[1]!).getByText('action_12')).toBeInTheDocument();
  expect(screen.queryByText('action_2')).not.toBeInTheDocument();
});

test('live MCP activity supports search filters and page size', async () => {
  const user = userEvent.setup();
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  renderPanel([
    { id: 'ws_1', name: 'Aevra' },
    { id: 'ws_2', name: 'Docs' },
  ]);
  const source = FakeEventSource.instances[0]!;

  act(() => {
    source.emit('activity', activity({ id: 'op_1', action: 'file_read', state: 'success' }));
    source.emit(
      'activity',
      activity({
        id: 'op_2',
        workspaceId: 'ws_2',
        kind: 'rpc',
        action: 'tools/list',
        state: 'error',
        actor: 'oauth:Claude',
      }),
    );
  });

  expect(screen.getByPlaceholderText('Search MCP activity…')).toBeInTheDocument();
  expect(screen.getByLabelText('Client')).toBeInTheDocument();
  expect(screen.getByLabelText('Workspace')).toBeInTheDocument();
  expect(screen.getByLabelText('Type')).toBeInTheDocument();
  expect(screen.getByLabelText('Status')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rows per page' })).toHaveTextContent('10');

  await user.click(screen.getByRole('button', { name: 'Type' }));
  await user.click(screen.getByRole('option', { name: 'RPC' }));
  expect(screen.getByText('tools/list')).toBeInTheDocument();
  expect(screen.queryByText('file_read')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Type' }));
  await user.click(screen.getByRole('option', { name: 'All' }));
  await user.type(screen.getByPlaceholderText('Search MCP activity…'), 'Claude');
  expect(screen.getByText('tools/list')).toBeInTheDocument();
  expect(screen.queryByText('file_read')).not.toBeInTheDocument();

  await user.clear(screen.getByPlaceholderText('Search MCP activity…'));
  await user.click(screen.getByRole('button', { name: 'Status' }));
  await user.click(screen.getByRole('option', { name: 'SUCCESS' }));
  expect(screen.getByText('file_read')).toBeInTheDocument();
  expect(screen.queryByText('tools/list')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Rows per page' }));
  await user.click(screen.getByRole('option', { name: '25' }));
  expect(screen.getByRole('button', { name: 'Rows per page' })).toHaveTextContent('25');
});

test('live MCP activity detail action shows sanitized input and output as JSON viewers', async () => {
  const user = userEvent.setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  renderPanel();
  const source = FakeEventSource.instances[0]!;
  const input = '{\n  "path": "README.md"\n}';
  const output = '{\n  "content": "[REDACTED]"\n}';

  act(() =>
    source.emit(
      'activity',
      activity({
        state: 'success',
        durationMs: 12,
        input,
        output,
      }),
    ),
  );

  await user.click(screen.getByRole('button', { name: 'Details' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('MCP activity details')).toBeInTheDocument();
  expect(within(dialog).getAllByTestId('json-detail-tree')).toHaveLength(2);
  expect(within(dialog).getByText('README.md')).toBeInTheDocument();
  expect(within(dialog).getByText('[REDACTED]')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Copy Output JSON' }));
  expect(writeText).toHaveBeenCalledWith(output);
});

test('live MCP activity detail preserves readable non-JSON output', async () => {
  const user = userEvent.setup();
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  renderPanel();
  const source = FakeEventSource.instances[0]!;

  act(() =>
    source.emit(
      'activity',
      activity({
        state: 'error',
        durationMs: 12,
        output: 'plain failure text',
      }),
    ),
  );

  await user.click(screen.getByRole('button', { name: 'Details' }));
  const dialog = screen.getByRole('dialog');
  const outputView = dialog.querySelector('[data-json-label="Output"]');
  expect(outputView).not.toBeNull();
  expect(within(outputView as HTMLElement).getByText('TEXT')).toBeInTheDocument();
  expect(within(outputView as HTMLElement).getByTestId('json-detail-raw')).toHaveTextContent(
    'plain failure text',
  );
});
