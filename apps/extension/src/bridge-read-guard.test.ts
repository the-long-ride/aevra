import { afterEach, expect, it, vi } from 'vitest';
import { createChromeBridge } from './bridge';
import { installChrome } from './bridge-test-support';

afterEach(() => {
  delete (globalThis as any).chrome;
});
it('read guard returns content only while its document stays stable and removes listeners', async () => {
  const fixture = installChrome([{ id: 1, active: true, url: 'https://example.test/' }]);
  expect(
    await createChromeBridge().guardRead!(
      '1',
      'https://example.test/',
      async () => 'ordinary words',
    ),
  ).toBe('ordinary words');
  expect(fixture.listenerCount()).toBe(0);
});
it('read guard discards content after even a same-URL reload', async () => {
  let listener: (id: number, info: { status: string }) => void = () => {};
  const removeListener = vi.fn();
  installChrome([{ id: 1, active: true, url: 'https://example.test/' }], {
    tabs: {
      onUpdated: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
        removeListener,
      },
    },
  });
  await expect(
    createChromeBridge().guardRead!('1', 'https://example.test/', async () => {
      listener(1, { status: 'loading' });
      return 'private ordinary words';
    }),
  ).rejects.toMatchObject({ code: 'BROWSER_ORIGIN_BLOCKED' });
  expect(removeListener).toHaveBeenCalledWith(listener);
});
it('read guard refuses a pending redirect before collecting data', async () => {
  let collected = false;
  installChrome([], {
    tabs: {
      get: async () => ({ url: 'https://example.test/', pendingUrl: 'http://localhost:47831/' }),
    },
  });
  await expect(
    createChromeBridge().guardRead!('1', 'https://example.test/', async () => {
      collected = true;
    }),
  ).rejects.toMatchObject({ code: 'BROWSER_ORIGIN_BLOCKED' });
  expect(collected).toBe(false);
});
