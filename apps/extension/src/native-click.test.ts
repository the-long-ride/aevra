import { afterEach, describe, expect, it, vi } from 'vitest';
import * as nativeInput from './native-click';

const { dispatchNativeClick } = nativeInput;

type Point = { x: number; y: number };

function installChrome(
  options: {
    url?: string;
    tabMissing?: boolean;
    fail?: 'attach' | 'press' | 'move' | 'release' | 'detach';
    attach?: () => Promise<void>;
    get?: () => Promise<void>;
    send?: (type: string) => Promise<void>;
  } = {},
) {
  const calls: unknown[][] = [];
  (globalThis as any).chrome = {
    tabs: {
      async get(id: number) {
        calls.push(['get', id]);
        await options.get?.();
        if (options.tabMissing) throw new Error('No tab with id');
        return { id, url: options.url ?? 'https://idngoalong.zing.vn/play-game-new' };
      },
    },
    debugger: {
      async attach(target: unknown, version: string) {
        calls.push(['attach', target, version]);
        if (options.fail === 'attach') throw new Error('Another debugger is already attached');
        await options.attach?.();
      },
      async sendCommand(target: unknown, method: string, params: { type: string } & Point) {
        calls.push(['send', target, method, params]);
        if (options.fail === 'press' && params.type === 'mousePressed')
          throw new Error('press failed');
        if (options.fail === 'move' && params.type === 'mouseMoved') throw new Error('move failed');
        if (options.fail === 'release' && params.type === 'mouseReleased')
          throw new Error('release failed');
        await options.send?.(params.type);
      },
      async detach(target: unknown) {
        calls.push(['detach', target]);
        if (options.fail === 'detach') throw new Error('detach failed');
      },
    },
  };
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as any).chrome;
});

describe('withDebuggerViewport', () => {
  it('discards work that completes after its request is cancelled', async () => {
    let cancelled = false;
    const calls = installChrome();
    await expect(
      nativeInput.withDebuggerViewport(
        9,
        async () => {
          cancelled = true;
          return 'late result';
        },
        () => cancelled,
      ),
    ).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE' });
    expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });
});

describe('dispatchNativeDrag', () => {
  const drag = () =>
    (
      nativeInput as unknown as {
        dispatchNativeDrag: (
          tabId: number,
          start: Point,
          end: Point,
          isCancelled?: () => boolean,
        ) => Promise<void>;
      }
    ).dispatchNativeDrag;

  it('presses, moves with the left button held, releases, then detaches', async () => {
    const calls = installChrome();
    await drag()(9, { x: 10, y: 20 }, { x: 110, y: 70 });
    const sent = calls.filter((call) => call[0] === 'send').map((call) => call[3] as any);
    expect(sent[0]).toMatchObject({ type: 'mousePressed', x: 10, y: 20, buttons: 1 });
    expect(sent.slice(1, -1).length).toBeGreaterThan(1);
    expect(
      sent.slice(1, -1).every((event) => event.type === 'mouseMoved' && event.buttons === 1),
    ).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: 'mouseReleased', x: 110, y: 70, buttons: 0 });
    expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('attempts mouse release and detach after a move fails', async () => {
    const calls = installChrome({ fail: 'move' });
    await expect(drag()(9, { x: 10, y: 20 }, { x: 110, y: 70 })).rejects.toMatchObject({
      code: 'BROWSER_INPUT_FAILED',
    });
    const sent = calls.filter((call) => call[0] === 'send').map((call) => call[3] as any);
    expect(sent.at(-1)?.type).toBe('mouseReleased');
    expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('attempts release if a press command is rejected after dispatch', async () => {
    const calls = installChrome({ fail: 'press' });
    await expect(drag()(9, { x: 10, y: 20 }, { x: 110, y: 70 })).rejects.toMatchObject({
      code: 'BROWSER_INPUT_FAILED',
    });
    const types = calls.filter((call) => call[0] === 'send').map((call) => (call[3] as any).type);
    expect(types).toEqual(['mousePressed', 'mouseReleased']);
    expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });

  it('releases without moving after cancellation during a held pause', async () => {
    let cancelled = false;
    const calls = installChrome({
      async send(type) {
        if (type === 'mousePressed')
          setTimeout(() => {
            cancelled = true;
          }, 5);
      },
    });
    await expect(
      drag()(9, { x: 10, y: 20 }, { x: 110, y: 70 }, () => cancelled),
    ).rejects.toMatchObject({ code: 'BROWSER_INPUT_FAILED' });
    const types = calls.filter((call) => call[0] === 'send').map((call) => (call[3] as any).type);
    expect(types).toEqual(['mousePressed', 'mouseReleased']);
    expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });
});

describe('dispatchNativeClick', () => {
  it('sends one browser-native left click to the exact tab and detaches', async () => {
    const calls = installChrome();
    await dispatchNativeClick(9, { x: 555, y: 620 });
    expect(calls).toEqual([
      ['get', 9],
      ['attach', { tabId: 9 }, '1.3'],
      [
        'send',
        { tabId: 9 },
        'Input.dispatchMouseEvent',
        {
          type: 'mousePressed',
          x: 555,
          y: 620,
          button: 'left',
          clickCount: 1,
        },
      ],
      [
        'send',
        { tabId: 9 },
        'Input.dispatchMouseEvent',
        {
          type: 'mouseReleased',
          x: 555,
          y: 620,
          button: 'left',
          clickCount: 1,
        },
      ],
      ['detach', { tabId: 9 }],
    ]);
  });

  it('waits for the debugger banner layout before sending the click', async () => {
    let bannerVisible = false;
    installChrome({
      async attach() {
        setTimeout(() => {
          bannerVisible = true;
        }, 40);
      },
      async send() {
        expect(bannerVisible).toBe(true);
      },
    });
    await dispatchNativeClick(9, { x: 555, y: 620 });
  });

  it('refuses a closed tab without attaching', async () => {
    const calls = installChrome({ tabMissing: true });
    await expect(dispatchNativeClick(9, { x: 555, y: 620 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(calls).toEqual([['get', 9]]);
  });

  it('refuses an internal browser URL without attaching', async () => {
    const calls = installChrome({ url: 'brave://settings/' });
    await expect(dispatchNativeClick(9, { x: 555, y: 620 })).rejects.toMatchObject({
      code: 'BROWSER_ORIGIN_BLOCKED',
    });
    expect(calls).toEqual([['get', 9]]);
  });

  it('reports a debugger ownership conflict without dispatching page events', async () => {
    const calls = installChrome({ fail: 'attach' });
    await expect(dispatchNativeClick(9, { x: 555, y: 620 })).rejects.toMatchObject({
      code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE',
    });
    expect(calls.map((call) => call[0])).toEqual(['get', 'attach']);
  });

  for (const stage of ['press', 'release', 'detach'] as const) {
    it(`reports ${stage} failure and attempts detach after attachment`, async () => {
      const calls = installChrome({ fail: stage });
      await expect(dispatchNativeClick(9, { x: 555, y: 620 })).rejects.toMatchObject({
        code: 'BROWSER_INPUT_FAILED',
      });
      expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
    });
  }

  it('bounds a hung attachment and detaches if it completes late', async () => {
    vi.useFakeTimers();
    let finishAttach!: () => void;
    const pendingAttach = new Promise<void>((resolve) => {
      finishAttach = resolve;
    });
    const calls = installChrome({ attach: () => pendingAttach });
    const attempt = dispatchNativeClick(9, { x: 555, y: 620 });
    const failed = expect(attempt).rejects.toMatchObject({
      code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await failed;
    finishAttach();
    await vi.waitFor(() => expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]));
    expect(calls.some((call) => call[0] === 'send')).toBe(false);
  });

  it('bounds a hung tab lookup before any debugger attachment', async () => {
    vi.useFakeTimers();
    const calls = installChrome({ get: () => new Promise<void>(() => {}) });
    const attempt = dispatchNativeClick(9, { x: 555, y: 620 });
    const failed = expect(attempt).rejects.toMatchObject({
      code: 'BROWSER_NATIVE_INPUT_UNAVAILABLE',
    });
    await vi.advanceTimersByTimeAsync(12_000);
    await failed;
    expect(calls).toEqual([['get', 9]]);
  });

  it('does not dispatch a click after cancellation during attachment', async () => {
    let finishAttach!: () => void;
    const pendingAttach = new Promise<void>((resolve) => {
      finishAttach = resolve;
    });
    let cancelled = false;
    const calls = installChrome({ attach: () => pendingAttach });
    const attempt = dispatchNativeClick(9, { x: 555, y: 620 }, () => cancelled);
    await vi.waitFor(() => expect(calls.some((call) => call[0] === 'attach')).toBe(true));
    cancelled = true;
    finishAttach();
    await expect(attempt).rejects.toMatchObject({ code: 'BROWSER_INPUT_FAILED' });
    expect(calls.some((call) => call[0] === 'send')).toBe(false);
    expect(calls.at(-1)).toEqual(['detach', { tabId: 9 }]);
  });
});
