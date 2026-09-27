import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearConsoleLogs, createChromeBridge } from './bridge';
import { installChrome } from './bridge-test-support';
import { fitVisibleCapture } from './vision-capture';

// The re-encode needs OffscreenCanvas, which jsdom lacks; it has its own suite.
vi.mock('./vision-capture', () => ({
  fitVisibleCapture: vi.fn(async () => ({
    imageDataUri: 'data:image/jpeg;base64,/9j/',
    devicePixelRatio: 0.5,
  })),
}));

beforeEach(() => clearConsoleLogs());
afterEach(() => {
  delete (globalThis as any).chrome;
});

describe('captureVisible', () => {
  it('captures after the debugger banner changes the tab viewport', async () => {
    const tab = {
      id: 9,
      active: true,
      url: 'https://idngoalong.zing.vn/',
      windowId: 1,
      width: 1200,
      height: 600,
    };
    const fake = installChrome([tab], {
      debugger: {
        async attach() {
          tab.height = 540;
        },
      },
    });
    await createChromeBridge().captureVisible('9');
    expect(fake.calls.debugger[0]).toEqual(['attach', { tabId: 9 }, '1.3']);
    expect(vi.mocked(fitVisibleCapture)).toHaveBeenLastCalledWith('data:image/jpeg;base64,AAAA', {
      width: 1200,
      height: 540,
    });
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('measures vision annotations before the debugger viewport is restored', async () => {
    const tab = {
      id: 9,
      active: true,
      url: 'https://example.test/',
      windowId: 1,
      width: 800,
      height: 600,
    };
    const fake = installChrome([tab], {
      debugger: {
        async attach() {
          tab.height = 540;
        },
        async detach() {
          tab.height = 600;
        },
      },
    });
    const capture = await createChromeBridge().captureVisible('9', undefined, async () => ({
      tagName: 'button',
      attributes: {},
      textContent: 'Bottom button',
      box: { x: 10, y: tab.height - 40, width: 100, height: 30 },
      children: [],
    }));
    expect(capture.annotationRoot?.box?.y).toBe(500);
    expect(tab.height).toBe(600);
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('detaches a stalled vision capture at its deadline and allows a later capture', async () => {
    vi.useFakeTimers();
    try {
      let stall = true;
      const fake = installChrome(
        [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
        {
          tabs: {
            async captureVisibleTab() {
              return stall ? new Promise<string>(() => {}) : 'data:image/jpeg;base64,AAAA';
            },
          },
        },
      );
      const first = createChromeBridge().captureVisible('1');
      const rejected = expect(first).rejects.toMatchObject({ code: 'BROWSER_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(26_000);
      await rejected;
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(1);
      stall = false;
      const second = createChromeBridge().captureVisible('1');
      await vi.advanceTimersByTimeAsync(200);
      await expect(second).resolves.toHaveProperty('imageDataUri');
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaches a stalled capture promptly when its request is cancelled', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const fake = installChrome(
        [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
        {
          tabs: {
            async captureVisibleTab() {
              return new Promise<string>(() => {});
            },
          },
        },
      );
      const capture = createChromeBridge().captureVisible(
        '1',
        undefined,
        undefined,
        () => cancelled,
      );
      const rejected = expect(capture).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
      await vi.advanceTimersByTimeAsync(150);
      cancelled = true;
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a cancelled vision request before attaching the debugger', async () => {
    const fake = installChrome([
      { id: 1, active: true, url: 'https://example.test/', windowId: 1 },
    ]);
    await expect(
      createChromeBridge().captureVisible('1', undefined, undefined, () => true),
    ).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
    expect(fake.calls.debugger).toEqual([]);
  });

  it('detaches if the tab becomes inactive while the debugger viewport settles', async () => {
    const tab = { id: 1, active: true, url: 'https://example.test/', windowId: 1 };
    const fake = installChrome([tab], {
      debugger: {
        async attach() {
          tab.active = false;
        },
      },
    });
    await expect(createChromeBridge().captureVisible('1')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
    expect(fake.calls.capture).toEqual([]);
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
  });

  it('does not begin capture if cancelled while the debugger viewport settles', async () => {
    vi.useFakeTimers();
    try {
      let cancelled = false;
      const fake = installChrome([
        { id: 1, active: true, url: 'https://example.test/', windowId: 1 },
      ]);
      const capture = createChromeBridge().captureVisible(
        '1',
        undefined,
        undefined,
        () => cancelled,
      );
      const rejected = expect(capture).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
      await vi.advanceTimersByTimeAsync(50);
      cancelled = true;
      await vi.advanceTimersByTimeAsync(200);
      await rejected;
      expect(fake.calls.capture).toEqual([]);
      expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaches when DOM annotation collection fails', async () => {
    const fake = installChrome([
      { id: 1, active: true, url: 'https://example.test/', windowId: 1 },
    ]);
    await expect(
      createChromeBridge().captureVisible('1', undefined, async () => {
        throw new Error('annotation failed');
      }),
    ).rejects.toThrow('annotation failed');
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
  });

  it('reports a failed debugger detach after capture', async () => {
    const fake = installChrome(
      [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
      {
        debugger: {
          async detach() {
            throw new Error('detach failed');
          },
        },
      },
    );
    await expect(createChromeBridge().captureVisible('1')).rejects.toMatchObject({
      code: 'BROWSER_INPUT_FAILED',
    });
    expect(fake.calls.debugger.at(-1)).toEqual(['detach', { tabId: 1 }]);
  });

  it('keeps a successful screenshot when a progress listener throws', async () => {
    installChrome([{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }]);
    await expect(
      createChromeBridge().captureVisible('1', () => {
        throw new Error('progress listener failed');
      }),
    ).resolves.toHaveProperty('imageDataUri');
  });

  it('ignores a capture result that arrives after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let finishCapture!: (frame: string) => void;
      const pendingFrame = new Promise<string>((resolve) => (finishCapture = resolve));
      const fake = installChrome(
        [{ id: 1, active: true, url: 'https://example.test/', windowId: 1 }],
        {
          tabs: { captureVisibleTab: () => pendingFrame },
        },
      );
      const progress: string[] = [];
      const capture = createChromeBridge().captureVisible('1', (event) =>
        progress.push(event.stage),
      );
      const rejected = expect(capture).rejects.toMatchObject({ code: 'BROWSER_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(26_000);
      await rejected;
      finishCapture('data:image/jpeg;base64,AAAA');
      await vi.advanceTimersByTimeAsync(0);
      expect(progress).toEqual(['capture_started']);
      expect(fake.calls.debugger.filter((entry) => entry[0] === 'detach')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a debugger conflict before returning coordinates that would not match input', async () => {
    const fake = installChrome(
      [{ id: 9, active: true, url: 'https://example.test/', windowId: 1 }],
      {
        debugger: {
          async attach() {
            throw new Error('DevTools owns target');
          },
        },
      },
    );
    await expect(createChromeBridge().captureVisible('9')).rejects.toMatchObject({
      code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE',
    });
    expect(fake.calls.capture).toEqual([]);
  });

  it('reports the capture API and encoding stages without image content', async () => {
    installChrome([{ id: 1, active: true, width: 800, height: 500 }]);
    const progress: Array<{ stage: string; elapsedMs: number; bytes?: number }> = [];
    await (createChromeBridge().captureVisible as any)('1', (event: any) => progress.push(event));
    expect(progress.map((event) => event.stage)).toEqual([
      'capture_started',
      'capture_api_done',
      'encode_done',
    ]);
    expect(progress.every((event) => Number.isFinite(event.elapsedMs))).toBe(true);
    expect(progress.at(-1)?.bytes).toBeGreaterThan(0);
    expect(JSON.stringify(progress)).not.toContain('imageDataUri');
  });

  it('grabs one jpeg frame and returns it fitted to the transport budget', async () => {
    const fake = installChrome([{ id: 1, active: true }]);
    const shot = await createChromeBridge().captureVisible();
    expect(fake.calls.capture![0]).toEqual({ format: 'jpeg', quality: 90 });
    expect(fake.calls.executeScript).toHaveLength(0);
    expect(vi.mocked(fitVisibleCapture)).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', null);
    expect(shot).toEqual({ imageDataUri: 'data:image/jpeg;base64,/9j/', devicePixelRatio: 0.5 });
  });

  it('uses tab viewport dimensions without asking the page for its pixel ratio', async () => {
    const fake = installChrome([{ id: 1, active: true, width: 800, height: 500 }]);
    await createChromeBridge().captureVisible('1');
    expect(fake.calls.executeScript).toHaveLength(0);
    expect(vi.mocked(fitVisibleCapture)).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA', {
      width: 800,
      height: 500,
    });
  });

  it('refuses vision capture for a named inactive tab instead of activating it', async () => {
    const fake = installChrome([
      { id: 1, active: true },
      { id: 2, active: false },
    ]);
    await expect(createChromeBridge().captureVisible('2')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
    expect(fake.calls.update).toHaveLength(0);
    expect(fake.calls.capture).toHaveLength(0);
  });

  it('captures a named tab when it is already active without changing selection', async () => {
    const fake = installChrome([{ id: 2, active: true }]);
    await createChromeBridge().captureVisible('2');
    expect(fake.calls.update).toHaveLength(0);
    expect(fake.calls.capture).toHaveLength(1);
  });

  it('rejects a screenshot if another tab becomes active during capture', async () => {
    const tabs = [
      { id: 1, active: true, windowId: 1 },
      { id: 2, active: false, windowId: 1 },
    ];
    installChrome(tabs, {
      tabs: {
        async captureVisibleTab() {
          tabs[0]!.active = false;
          tabs[1]!.active = true;
          return 'data:image/jpeg;base64,AAAA';
        },
      },
    });
    await expect(createChromeBridge().captureVisible('1')).rejects.toMatchObject({
      code: 'BROWSER_CAPTURE_REQUIRES_ACTIVE_TAB',
    });
  });
});
