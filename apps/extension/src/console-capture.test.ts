import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyPageAction,
  installConsoleCapture,
  installConsoleRelay,
  readDevicePixelRatio,
} from './content';

// The capture patches `console` in place and vitest's own restore does not know
// about it, so without this every case would run through the wrappers the
// previous cases left behind and post each line more than once.
const CONSOLE_ORIGINALS: Record<string, unknown> = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

function setRatio(value: unknown) {
  Object.defineProperty(window, 'devicePixelRatio', { value, configurable: true });
}

function resetWorldMarkers() {
  const scope = window as unknown as Record<string, unknown>;
  delete scope.__aevraConsoleCaptured;
  // The relay's marker is deliberately left in place: its listener cannot be
  // removed from the outside, so clearing the marker would stack a fresh
  // listener per case and forward every line as many times as cases have run.
}

/** postMessage is delivered as a task, so a relay assertion has to yield first. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  resetWorldMarkers();
  setRatio(1);
  vi.restoreAllMocks();
  for (const [level, fn] of Object.entries(CONSOLE_ORIGINALS)) {
    (console as unknown as Record<string, unknown>)[level] = fn;
  }
  delete (globalThis as any).chrome;
});

describe('readDevicePixelRatio', () => {
  it('reports the display ratio', () => {
    setRatio(2.5);
    expect(readDevicePixelRatio()).toBe(2.5);
  });

  it('falls back to 1 when the ratio is absent or nonsense', () => {
    setRatio(undefined);
    expect(readDevicePixelRatio()).toBe(1);
    setRatio(0);
    expect(readDevicePixelRatio()).toBe(1);
    setRatio(Number.NaN);
    expect(readDevicePixelRatio()).toBe(1);
  });
});

describe('installConsoleCapture', () => {
  it('posts each console line while still calling through to the original', () => {
    const posted: unknown[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data);
    });
    const original = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(installConsoleCapture()).toBe(true);
    console.log('hello', 42);

    expect(original).toHaveBeenCalled();
    expect(posted).toEqual([{ source: 'aevra:console', level: 'log', text: 'hello 42' }]);
  });

  it('serializes objects and survives values that cannot be stringified', () => {
    const posted: any[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data);
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    installConsoleCapture();

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    console.warn({ a: 1 }, cyclic);

    expect(posted[0].level).toBe('warn');
    expect(posted[0].text).toContain('{"a":1}');
  });

  it('is idempotent, so repeated injection does not multiply every line', () => {
    const posted: unknown[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(installConsoleCapture()).toBe(true);
    expect(installConsoleCapture()).toBe(false);
    console.error('once');

    expect(posted).toHaveLength(1);
  });

  it('never lets a failing post break the page', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {
      throw new Error('postMessage refused');
    });
    const original = vi.spyOn(console, 'info').mockImplementation(() => {});
    installConsoleCapture();

    expect(() => console.info('still works')).not.toThrow();
    expect(original).toHaveBeenCalledWith('still works');
  });

  it('truncates a very long line rather than buffering it whole', () => {
    const posted: any[] = [];
    vi.spyOn(window, 'postMessage').mockImplementation((data: unknown) => {
      posted.push(data);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    installConsoleCapture();

    console.log('x'.repeat(5000));
    expect(posted[0].text).toHaveLength(2000);
  });
});

describe('installConsoleRelay', () => {
  function installRuntime() {
    const sent: unknown[] = [];
    (globalThis as any).chrome = { runtime: { sendMessage: (m: unknown) => sent.push(m) } };
    return sent;
  }

  // One install for the whole describe, because jsdom's window outlives each
  // case. `chrome` is re-faked per case and the listener reads it at call time,
  // so every case still gets its own capture list.
  const firstInstall = installConsoleRelay();

  it('installs its listener once and refuses to stack a second', () => {
    expect(firstInstall).toBe(true);
    expect(installConsoleRelay()).toBe(false);
  });

  it('forwards a captured line to the service worker', async () => {
    const sent = installRuntime();

    window.postMessage({ source: 'aevra:console', level: 'warn', text: 'from the page' }, '*');
    await settle();

    expect(sent).toEqual([{ type: 'aevra:console', level: 'warn', text: 'from the page' }]);
  });

  it('ignores messages that are not console captures', async () => {
    const sent = installRuntime();
    installConsoleRelay();

    window.postMessage({ source: 'something-else', text: 'ignored' }, '*');
    window.postMessage('a bare string', '*');
    await settle();

    expect(sent).toEqual([]);
  });

  it('defaults a capture that arrives without a level or text', async () => {
    const sent = installRuntime();
    installConsoleRelay();

    window.postMessage({ source: 'aevra:console' }, '*');
    await settle();

    expect(sent).toEqual([{ type: 'aevra:console', level: 'log', text: '' }]);
  });

  it('forwards each line exactly once', async () => {
    const sent = installRuntime();

    window.postMessage({ source: 'aevra:console', level: 'log', text: 'one' }, '*');
    await settle();

    expect(sent).toHaveLength(1);
  });

  it('ignores a message posted by another frame', async () => {
    const sent = installRuntime();
    installConsoleRelay();
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'aevra:console', level: 'log', text: 'from a subframe' },
        source: frame.contentWindow,
      }),
    );
    await settle();

    expect(sent).toEqual([]);
  });
});

describe('coordinate clicks under a scaled display', () => {
  it('converts screenshot pixels to CSS pixels before hit testing', () => {
    setRatio(2);
    const target = document.createElement('button');
    const click = vi.fn();
    target.click = click;
    const hitTest = vi.fn().mockReturnValue(target);
    document.elementFromPoint = hitTest as never;

    const outcome = applyPageAction({ op: 'click', x: 200, y: 100 }, null);

    expect(hitTest).toHaveBeenCalledWith(100, 50);
    expect(click).toHaveBeenCalled();
    expect(outcome).toEqual({ ok: true });
  });

  it('passes coordinates through unchanged on an unscaled display', () => {
    setRatio(1);
    const target = document.createElement('button');
    target.click = vi.fn();
    const hitTest = vi.fn().mockReturnValue(target);
    document.elementFromPoint = hitTest as never;

    applyPageAction({ op: 'click', x: 200, y: 100 }, null);

    expect(hitTest).toHaveBeenCalledWith(200, 100);
  });

  it('reports NOT_FOUND when nothing sits at the converted point', () => {
    setRatio(3);
    document.elementFromPoint = vi.fn().mockReturnValue(null) as never;
    expect(applyPageAction({ op: 'click', x: 30, y: 60 }, null)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});
