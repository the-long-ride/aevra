export {};

// Speaks the helper protocol so HelperProcess can be tested with no OS.
// Modes, by argv[2]: normal | slow | garbage | die-on-second | driver |
// driver-fail-first-state | driver-fail-second-state
const mode = process.argv[2] ?? 'normal';
let seen = 0;
let buffer = '';
let actCount = 0;
let screenStateCount = 0;

// A supervisor bug (fixed in 69bac82, see helper-process.ts) could once null
// its only reference to a live child while that child was still running,
// leaving it orphaned: nothing in-process could reach it to kill() it. If
// that ever regresses, a bounded test assertion can still fail cleanly, but
// it cannot reap a child whose reference is gone -- and an unreaped 'slow'
// instance (which never answers by design) would hold its stdio pipe open
// and wedge the whole test run for the external timeout. So this fixture
// guarantees its OWN upper bound on lifetime, independent of whether anything
// still holds a reference to it. Deliberately NOT unref()'d: an unref'd timer
// lets the process exit early once its event loop is otherwise idle, which is
// the opposite of a guaranteed deadline. 5s is well above the longest
// deadlineMs used in helper-process.unit.test.ts (1000ms), so it never
// interferes with a real test, including 'slow' mode, whose tests finish
// with a deadline of 150ms or less long before this fires.
setTimeout(() => process.exit(0), 5000);

process.stdin.on('data', (chunk: Buffer | string) => {
  buffer += String(chunk);
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    handle(line);
    index = buffer.indexOf('\n');
  }
});

const FOCUSED_WINDOW = { windowId: 'w1', processName: 'notepad.exe', title: 'Untitled' };

// Not a real PNG -- same low-entropy placeholder shape as fake-driver.ts.
// Nothing decodes this value; the only assertion anywhere is a prefix/length
// regex on the data URI, so a real image blob (a secret-shaped, high-entropy
// base64 literal) is deliberately avoided in this fixture.
const PIXEL = `data:image/png;base64,${'a'.repeat(64)}`;

function driverResult(method: string): unknown {
  switch (method) {
    case 'connect':
      return { capture: true, tree: true, attribution: true, input: true };
    case 'windows':
      return [FOCUSED_WINDOW];
    case 'focusedWindow':
      return FOCUSED_WINDOW;
    case 'describe':
      return {
        window: FOCUSED_WINDOW,
        nodes: [{ handle: 'h1', role: 'button', name: 'Save', enabled: true, focused: false }],
        truncated: false,
      };
    case 'capture':
      return { imageDataUri: PIXEL, devicePixelRatio: 1, window: FOCUSED_WINDOW };
    case 'screenState':
      // The signature folds in a counter that `act` bumps, so a caller that
      // diffs before/after state across an act sees a real change rather than
      // a hardcoded one.
      return { window: FOCUSED_WINDOW, windowIds: ['w1'], signature: `s${actCount}` };
    case 'act':
      actCount += 1;
      return true;
    case 'targetIdentity':
      return {
        window: FOCUSED_WINDOW,
        windowInstance: {
          windowId: 'w1',
          processId: 1234,
          processStartedAt: '2026-09-18T00:00:00Z',
        },
      };
    case 'describeBackground':
      return {
        window: FOCUSED_WINDOW,
        windowInstance: {
          windowId: 'w1',
          processId: 1234,
          processStartedAt: '2026-09-18T00:00:00Z',
        },
        nodes: [
          {
            handle: 'h1',
            role: 'button',
            name: 'Save',
            enabled: true,
            focused: false,
            supportedActions: ['invoke'],
          },
        ],
        truncated: false,
      };
    case 'releaseBackgroundSnapshot':
      return true;
    case 'backgroundAct':
      return {
        ok: true,
        outcome: 'completed',
        focusChanged: false,
      };
    default:
      return null;
  }
}

function handle(line: string): void {
  const request = JSON.parse(line) as { id: number; method: string };
  seen += 1;
  if (mode === 'garbage') {
    process.stdout.write('this is not json\n');
    return;
  }
  if (mode === 'slow') return; // never answers
  if (mode === 'die-on-second' && seen >= 2) process.exit(3);

  if (mode.startsWith('driver')) {
    if (request.method === 'screenState') {
      screenStateCount += 1;
      // Simulates the trailing (or leading) screenState call of act() timing
      // out: never answer that one specific call, everything else responds
      // normally. Used to test that a leading-screenState failure rejects
      // act() while a trailing-screenState failure does not.
      if (mode === 'driver-fail-first-state' && screenStateCount === 1) return;
      if (mode === 'driver-fail-second-state' && screenStateCount === 2) return;
    }
    process.stdout.write(
      `${JSON.stringify({ id: request.id, result: driverResult(request.method) })}\n`,
    );
    return;
  }

  process.stdout.write(`${JSON.stringify({ id: request.id, result: { echo: request.method } })}\n`);
}
