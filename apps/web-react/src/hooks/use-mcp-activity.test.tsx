import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { McpActivityProvider, useMcpActivityEntries } from './use-mcp-activity';

class FakeEventSource {
  static latest: FakeEventSource | null = null;

  readonly url: string;
  readonly close = vi.fn();
  private readonly listeners = new Map<string, EventListener>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  emit(type: string, data: string) {
    this.listeners.get(type)?.(new MessageEvent(type, { data }));
  }
}

test('MCP activity stream tracks valid entries and ignores malformed payloads', () => {
  vi.stubGlobal('EventSource', FakeEventSource);
  const { result, unmount } = renderHook(() => useMcpActivityEntries(), {
    wrapper: McpActivityProvider,
  });
  const source = FakeEventSource.latest;

  expect(source).not.toBeNull();
  expect(source?.url).toBe('/api/activity/stream');

  act(() => {
    source?.emit(
      'activity',
      JSON.stringify({
        id: 'tool-1',
        actor: 'oauth:test',
        sessionId: 'session-1',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        kind: 'tool',
        state: 'running',
        action: 'files.read',
      }),
    );
  });
  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toMatchObject({ id: 'tool-1', state: 'running' });

  act(() => {
    source?.emit(
      'activity',
      JSON.stringify({
        id: 'tool-1',
        actor: 'oauth:test',
        sessionId: 'session-1',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        kind: 'tool',
        state: 'success',
        action: 'files.read',
      }),
    );
  });
  expect(result.current).toHaveLength(1);
  expect(result.current[0]).toMatchObject({ id: 'tool-1', state: 'success' });

  act(() => {
    source?.emit('activity', JSON.stringify({ state: 'success' }));
    source?.emit('activity', '{not-json');
  });
  expect(result.current).toHaveLength(1);

  unmount();
  expect(source?.close).toHaveBeenCalledOnce();
});
