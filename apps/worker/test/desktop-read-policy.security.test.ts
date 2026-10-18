import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchDesktopRead } from '../src/desktop-read-dispatch.js';
import { defaultDesktopPolicy } from '../../../packages/security/src/desktop-policy-defaults.js';

test('desktop description refuses a target changed into the admin UI during the read', async () => {
  const driver: any = {
    focusedWindow: async () => ({
      windowId: 'one',
      processName: 'chrome.exe',
      title: 'Example - Google Chrome',
    }),
    describe: async () => ({
      window: { windowId: 'one', processName: 'chrome.exe', title: 'Aevra - Google Chrome' },
      nodes: [],
    }),
  };
  await assert.rejects(
    () =>
      dispatchDesktopRead(
        {
          kind: 'desktop.describe',
          maxNodes: 10,
          interactiveOnly: false,
          policy: defaultDesktopPolicy(),
        },
        driver,
      ),
    { code: 'DESKTOP_INPUT_REFUSED' },
  );
});

const app = {
  windowId: 'one',
  processName: 'custom.exe',
  executablePath: 'C:/Apps/custom.exe',
  title: 'Ordinary',
};
const granted: any = {
  mode: 'allowlist',
  applications: [],
  unattributedInput: 'deny',
  deniedTitlePatterns: ['Aevra'],
  appGrants: [
    {
      id: 'grant',
      executablePath: app.executablePath,
      displayName: 'Custom',
      createdAt: '2026-10-15',
      sessionId: 'session',
    },
  ],
};
test('desktop reads honor session-bound exact-path grants', async () => {
  const driver: any = {
    focusedWindow: async () => app,
    describe: async () => ({ window: app, nodes: [], truncated: false }),
    windows: async () => [app],
    capture: async () => ({ window: app, imageDataUri: 'ordinary image', devicePixelRatio: 1 }),
  };
  const op: any = {
    kind: 'desktop.describe',
    maxNodes: 10,
    interactiveOnly: false,
    policy: granted,
  };
  const result = await dispatchDesktopRead(op, driver, 'session');
  assert.ok(result.window);
  assert.equal(result.window.windowId, 'one');
  await assert.rejects(() => dispatchDesktopRead(op, driver, 'other'), {
    code: 'DESKTOP_INPUT_REFUSED',
  });
});

test('full-screen capture returns worker policy evidence and refuses a protected post-capture window', async () => {
  let protectedWindow = false;
  const driver: any = {
    windows: async () => [{ ...app, title: protectedWindow ? 'Aevra' : 'Ordinary' }],
    capture: async () => ({ window: null, imageDataUri: 'ordinary image', devicePixelRatio: 1 }),
  };
  const op: any = { kind: 'desktop.capture', policy: granted };
  assert.equal((await dispatchDesktopRead(op, driver, 'session')).readPolicy.scope, 'screen');
  driver.capture = async () => {
    protectedWindow = true;
    return { window: null, imageDataUri: 'ordinary image', devicePixelRatio: 1 };
  };
  await assert.rejects(() => dispatchDesktopRead(op, driver, 'session'), {
    code: 'DESKTOP_INPUT_REFUSED',
  });
});
