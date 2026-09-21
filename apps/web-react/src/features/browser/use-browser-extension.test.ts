import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { requestJson } from '../../services/api-client';
import { useBrowserExtension, useBrowserExtensionInfo } from './use-browser-extension';

vi.mock('../../services/api-client', () => ({ requestJson: vi.fn() }));

const request = vi.mocked(requestJson);

beforeEach(() => {
  request.mockReset();
});

it('reports a paired extension', async () => {
  request.mockResolvedValue({ extensionId: 'a'.repeat(32), pairedAt: '2026-01-01T00:00:00Z' });
  const { result } = renderHook(() => useBrowserExtension());
  await waitFor(() => expect(result.current).toBe('paired'));
});

it('reports a missing extension when nothing is paired', async () => {
  request.mockResolvedValue({ extensionId: null, pairedAt: null });
  const { result } = renderHook(() => useBrowserExtension());
  await waitFor(() => expect(result.current).toBe('missing'));
});

it('stays unknown when the route is unavailable', async () => {
  request.mockRejectedValue(new Error('BROWSER_UNAVAILABLE'));
  const { result } = renderHook(() => useBrowserExtension());
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(result.current).toBe('unknown');
});

it('asks core once and aborts the request when unmounted mid-flight', async () => {
  request.mockImplementation(() => new Promise(() => {}));
  const { unmount } = renderHook(() => useBrowserExtension());
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  const options = request.mock.calls[0]![1] as { signal: AbortSignal };
  expect(options.signal.aborted).toBe(false);
  unmount();
  expect(options.signal.aborted).toBe(true);
});

it('detects installed extension via custom event and postMessage', async () => {
  request.mockResolvedValue({ extensionId: null, pairedAt: null });
  const { result } = renderHook(() => useBrowserExtensionInfo());

  // 1. Dispatch custom event
  const customEvent = new CustomEvent('aevra:extension-detected', {
    detail: { installed: true, version: '1.0.5' },
  });
  window.dispatchEvent(customEvent);

  await waitFor(() => {
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.version).toBe('1.0.5');
  });

  // 2. Dispatch pong message
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'aevra:pong-extension', version: '1.1.0' },
    }),
  );

  await waitFor(() => {
    expect(result.current.version).toBe('1.1.0');
  });
});

it('initializes from documentElement attributes if already present', () => {
  document.documentElement.setAttribute('data-aevra-extension-installed', 'true');
  document.documentElement.setAttribute('data-aevra-extension-version', '2.0.0');
  try {
    const { result } = renderHook(() => useBrowserExtensionInfo());
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.version).toBe('2.0.0');
  } finally {
    document.documentElement.removeAttribute('data-aevra-extension-installed');
    document.documentElement.removeAttribute('data-aevra-extension-version');
  }
});
