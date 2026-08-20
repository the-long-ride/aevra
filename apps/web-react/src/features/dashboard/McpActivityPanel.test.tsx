import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
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

test('live MCP activity merges lifecycle updates by operation id', () => {
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  render(<McpActivityPanel workspaces={[{ id: 'ws_1', name: 'Aevra' }]} />);

  const source = FakeEventSource.instances[0]!;
  expect(source.url).toBe('/api/activity/stream');
  act(() => source.onopen?.());
  act(() =>
    source.emit('activity', {
      id: 'op_1',
      startedAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      actor: 'oauth:ChatGPT',
      sessionId: 'ses_1',
      workspaceId: 'ws_1',
      kind: 'tool',
      action: 'file_read',
      state: 'running',
    }),
  );

  expect(screen.getByText('RUNNING')).toBeInTheDocument();
  expect(screen.getByText('ChatGPT')).toBeInTheDocument();
  expect(screen.getByText('Aevra')).toBeInTheDocument();

  act(() =>
    source.emit('activity', {
      id: 'op_1',
      startedAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.012Z',
      actor: 'oauth:ChatGPT',
      sessionId: 'ses_1',
      workspaceId: 'ws_1',
      kind: 'tool',
      action: 'file_read',
      state: 'success',
      durationMs: 12,
    }),
  );

  expect(screen.queryByText('RUNNING')).not.toBeInTheDocument();
  expect(screen.getByText('SUCCESS')).toBeInTheDocument();
  expect(screen.getByText('12 ms')).toBeInTheDocument();
  expect(screen.getAllByText('file_read')).toHaveLength(1);
});
