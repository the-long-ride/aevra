const INPUT_DEADLINE_MS = 12_000;
const DETACH_DEADLINE_MS = 2_000;
const CAPTURE_DEADLINE_MS = 25_000;
const DEBUGGER_VIEWPORT_SETTLE_MS = 150;
const DRAG_STEPS = 8;
const DRAG_STEP_MS = 20;

class InputDeadlineError extends Error {}

type NativeInputCode =
  | 'NOT_FOUND'
  | 'BROWSER_ORIGIN_BLOCKED'
  | 'BROWSER_NATIVE_INPUT_UNAVAILABLE'
  | 'BROWSER_INPUT_FAILED';

function inputError(code: NativeInputCode, tabId: number): Error & { code: NativeInputCode } {
  return Object.assign(new Error(`${code} for tab ${tabId}`), { code });
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) throw new InputDeadlineError('Native input deadline exceeded');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new InputDeadlineError('Native input deadline exceeded')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function validateTab(tabId: number, deadline: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await bounded(chrome.tabs.get(tabId), deadline - Date.now());
  } catch (error) {
    if (error instanceof InputDeadlineError) {
      throw inputError('BROWSER_NATIVE_INPUT_UNAVAILABLE', tabId);
    }
    throw inputError('NOT_FOUND', tabId);
  }
  if (tab.id !== tabId) throw inputError('NOT_FOUND', tabId);
  let protocol: string;
  try {
    protocol = new URL(tab.url ?? '').protocol;
  } catch {
    throw inputError('BROWSER_ORIGIN_BLOCKED', tabId);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw inputError('BROWSER_ORIGIN_BLOCKED', tabId);
  }
}

async function attachTarget(tabId: number, deadline: number): Promise<{ tabId: number }> {
  const target = { tabId };
  let attachSettled = false;
  const attachment = Promise.resolve()
    .then(() => chrome.debugger.attach(target, '1.3'))
    .then(
      () => {
        attachSettled = true;
      },
      (error) => {
        attachSettled = true;
        throw error;
      },
    );
  try {
    await bounded(attachment, deadline - Date.now());
    return target;
  } catch {
    if (!attachSettled) {
      void attachment.then(() => chrome.debugger.detach(target)).catch(() => {});
    }
    throw inputError('BROWSER_NATIVE_INPUT_UNAVAILABLE', tabId);
  }
}

/** Sends one browser-native click; this helper owns no debugger session beyond the call. */
export async function dispatchNativeClick(
  tabId: number,
  point: { x: number; y: number },
  isCancelled?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + INPUT_DEADLINE_MS;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw inputError('BROWSER_INPUT_FAILED', tabId);
  }

  await validateTab(tabId, deadline);
  if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
  const target = await attachTarget(tabId, deadline);

  let failure: Error | undefined;
  try {
    if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
    // Chromium's debugger notice changes the visible viewport. Wait for the
    // same layout used by vision captures before dispatching coordinates.
    await bounded(
      new Promise<void>((resolve) => setTimeout(resolve, DEBUGGER_VIEWPORT_SETTLE_MS)),
      deadline - Date.now(),
    );
    if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
    for (const type of ['mousePressed', 'mouseReleased'] as const) {
      await bounded(
        chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type,
          x: point.x,
          y: point.y,
          button: 'left',
          clickCount: 1,
        }),
        deadline - Date.now(),
      );
    }
    if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
  } catch {
    failure = inputError('BROWSER_INPUT_FAILED', tabId);
  } finally {
    try {
      await bounded(chrome.debugger.detach(target), DETACH_DEADLINE_MS);
    } catch {
      failure = inputError('BROWSER_INPUT_FAILED', tabId);
    }
  }
  if (failure) throw failure;
}

/** Sends a held left-button drag through one short-lived debugger attachment. */
export async function dispatchNativeDrag(
  tabId: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
  isCancelled?: () => boolean,
): Promise<void> {
  const deadline = Date.now() + INPUT_DEADLINE_MS;
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) {
    throw inputError('BROWSER_INPUT_FAILED', tabId);
  }
  await validateTab(tabId, deadline);
  if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
  const target = await attachTarget(tabId, deadline);
  let pressed = false;
  let last = start;
  let failure: Error | undefined;
  try {
    await bounded(
      new Promise<void>((resolve) => setTimeout(resolve, DEBUGGER_VIEWPORT_SETTLE_MS)),
      deadline - Date.now(),
    );
    if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
    pressed = true;
    await bounded(
      chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: start.x,
        y: start.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      }),
      deadline - Date.now(),
    );
    for (let step = 1; step <= DRAG_STEPS; step++) {
      if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
      await bounded(
        new Promise<void>((resolve) => setTimeout(resolve, DRAG_STEP_MS)),
        deadline - Date.now(),
      );
      if (isCancelled?.()) throw inputError('BROWSER_INPUT_FAILED', tabId);
      const point = {
        x: start.x + ((end.x - start.x) * step) / DRAG_STEPS,
        y: start.y + ((end.y - start.y) * step) / DRAG_STEPS,
      };
      await bounded(
        chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: point.x,
          y: point.y,
          button: 'left',
          buttons: 1,
        }),
        deadline - Date.now(),
      );
      last = point;
    }
  } catch {
    failure = inputError('BROWSER_INPUT_FAILED', tabId);
  } finally {
    if (pressed) {
      try {
        await bounded(
          chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x: last.x,
            y: last.y,
            button: 'left',
            buttons: 0,
            clickCount: 1,
          }),
          DETACH_DEADLINE_MS,
        );
      } catch {
        failure = inputError('BROWSER_INPUT_FAILED', tabId);
      }
    }
    try {
      await bounded(chrome.debugger.detach(target), DETACH_DEADLINE_MS);
    } catch {
      failure = inputError('BROWSER_INPUT_FAILED', tabId);
    }
  }
  if (failure) throw failure;
}

/** Captures in the same temporary debugger-banner viewport used by native clicks. */
export async function withDebuggerViewport<T>(
  tabId: number,
  work: (isLive: () => boolean) => Promise<T>,
  isCancelled?: () => boolean,
): Promise<T> {
  const deadline = Date.now() + CAPTURE_DEADLINE_MS;
  await validateTab(tabId, deadline);
  if (isCancelled?.())
    throw Object.assign(new Error('Browser capture cancelled'), { code: 'BROWSER_UNAVAILABLE' });
  const target = await attachTarget(tabId, deadline);
  let live = true;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  try {
    // Chromium's debugger notice can resize a visible tab; let the viewport
    // settle before measuring it and taking the screenshot.
    await bounded(
      new Promise<void>((resolve) => setTimeout(resolve, DEBUGGER_VIEWPORT_SETTLE_MS)),
      deadline - Date.now(),
    );
    if (isCancelled?.())
      throw Object.assign(new Error('Browser capture cancelled'), { code: 'BROWSER_UNAVAILABLE' });
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw Object.assign(new Error('Browser capture timed out'), { code: 'BROWSER_TIMEOUT' });
    }
    const expired = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () =>
          reject(
            Object.assign(new Error('Browser capture timed out'), { code: 'BROWSER_TIMEOUT' }),
          ),
        remaining,
      );
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      poll = setInterval(() => {
        if (isCancelled?.())
          reject(
            Object.assign(new Error('Browser capture cancelled'), { code: 'BROWSER_UNAVAILABLE' }),
          );
      }, 25);
    });
    const result = await Promise.race([work(() => live && !isCancelled?.()), expired, cancelled]);
    if (isCancelled?.())
      throw Object.assign(new Error('Browser capture cancelled'), { code: 'BROWSER_UNAVAILABLE' });
    return result;
  } finally {
    live = false;
    if (timeout) clearTimeout(timeout);
    if (poll) clearInterval(poll);
    try {
      await bounded(chrome.debugger.detach(target), DETACH_DEADLINE_MS);
    } catch {
      throw inputError('BROWSER_INPUT_FAILED', tabId);
    }
  }
}
