import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AevraToolError } from '../src/errors.js';
import {
  isValidDesktopPolicy,
  policyFor,
  redactNode,
  redactWindow,
  sanitizeDesktopToolError,
  targetOf,
} from '../src/desktop-support.js';

// Computed at runtime so no secret-shaped literal lives in the source.
const shaped = createHash('sha256').update('desktop-support fixture phrase').digest('hex');

const base = { mode: 'allowlist', applications: ['notepad.exe'], unattributedInput: 'deny' };
const grant = {
  id: 'g1',
  executablePath: 'C:\\Apps\\tool.exe',
  displayName: 'Tool',
  createdAt: '2026-01-01T00:00:00Z',
};

function ctx(stored: unknown, grants?: unknown[]) {
  return {
    deps: {
      settings: { get: () => stored },
      ...(grants ? { desktopAccess: { policyGrants: () => grants } } : {}),
    },
  } as any;
}

test('isValidDesktopPolicy rejects every malformed field and accepts complete policies', () => {
  const bad: unknown[] = [
    null,
    'allowlist',
    { ...base, mode: 'open' },
    { ...base, applications: 'notepad.exe' },
    { ...base, applications: ['ok.exe', 3] },
    { ...base, exposeExecutablePaths: 'yes' },
    { ...base, unattributedInput: 'maybe' },
    { ...base, deniedTitlePatterns: 'Aevra' },
    { ...base, deniedTitlePatterns: ['Aevra', 1] },
    { ...base, appGrants: {} },
    { ...base, appGrants: [null] },
    { ...base, appGrants: [{ ...grant, id: ' ' }] },
    { ...base, appGrants: [{ ...grant, executablePath: 5 }] },
    { ...base, appGrants: [{ ...grant, displayName: '' }] },
    { ...base, appGrants: [{ ...grant, createdAt: undefined }] },
    { ...base, appGrants: [{ ...grant, sessionId: 9 }] },
  ];
  for (const value of bad) assert.equal(isValidDesktopPolicy(value), false, JSON.stringify(value));
  assert.equal(isValidDesktopPolicy(base), true);
  assert.equal(
    isValidDesktopPolicy({
      ...base,
      mode: 'denylist',
      unattributedInput: 'allow',
      exposeExecutablePaths: true,
      deniedTitlePatterns: ['Aevra'],
      appGrants: [grant, { ...grant, id: 'g2', sessionId: 's1' }],
    }),
    true,
  );
});

test('policyFor falls back to the default on invalid settings and injects live grants', () => {
  const fallback = policyFor(ctx({ unattributedInput: 'allow' }));
  assert.equal(fallback.mode, 'denylist');
  assert.ok(fallback.applications.includes('cmd.exe'));
  assert.deepEqual(fallback.appGrants, []);
  const stored = policyFor(ctx(base, [grant]), 's1');
  assert.equal(stored.mode, 'allowlist');
  assert.deepEqual(stored.appGrants, [grant]);
  assert.equal(policyFor({ deps: {} } as any).mode, 'denylist');
});

const refused = (details: any, message = 'Input refused') =>
  new AevraToolError('DESKTOP_INPUT_REFUSED', message, details);

test('sanitizeDesktopToolError passes through errors without object details', () => {
  const plain = new AevraToolError('DESKTOP_UNAVAILABLE', 'boom');
  assert.equal(sanitizeDesktopToolError(ctx(base), 's1', plain), plain);
});

test('allowlist refusals offer an access request and hide native paths', () => {
  const error = sanitizeDesktopToolError(
    ctx(base),
    's1',
    refused({
      window: {
        windowId: 'w1',
        processName: 'tool.exe',
        title: 'Tool',
        executablePath: 'C:\\Apps\\tool.exe',
      },
      gateRule: 'Refused by allowlist',
      extra: 1,
    }),
  );
  assert.match(error.message, /desktop_request_access/);
  const d = error.details as any;
  assert.equal(d.accessRequestAvailable, true);
  assert.equal(d.window.executablePath, 'tool.exe');
  assert.equal(d.gateRule, 'Refused by allowlist');
  assert.equal(d.reason, 'Refused by allowlist');
  assert.equal(d.extra, 1);
  assert.equal('redactionCount' in d, false);
  assert.equal('verifiedHostApplication' in d, false);
});

test('access requests are withheld for protected titles, webviews without host, and denylists', () => {
  const protectedTitle = sanitizeDesktopToolError(
    ctx({ ...base, deniedTitlePatterns: ['Aevra'] }),
    's1',
    refused({ window: { windowId: 'w1', title: 'Aevra' }, gateRule: 'refused by allowlist' }),
  );
  assert.equal((protectedTitle.details as any).accessRequestAvailable, false);
  assert.doesNotMatch(protectedTitle.message, /desktop_request_access/);

  const webview = { windowId: 'w2', processName: 'msedgewebview2.exe', title: 'App' };
  const noHost = sanitizeDesktopToolError(
    ctx(base),
    's1',
    refused({ window: webview, gateRule: 'refused by allowlist' }),
  );
  assert.equal((noHost.details as any).accessRequestAvailable, false);

  const webviewByPath = { windowId: 'w2', executablePath: 'C:\\x\\MSEdgeWebView2.exe', title: 'A' };
  const withHost = sanitizeDesktopToolError(
    ctx({ ...base, exposeExecutablePaths: true }),
    's1',
    refused({
      window: webviewByPath,
      hostApplication: { executablePath: 'C:\\Apps\\host.exe' },
      gateRule: 'refused by allowlist',
    }),
  );
  const hd = withHost.details as any;
  assert.equal(hd.accessRequestAvailable, true);
  assert.deepEqual(hd.verifiedHostApplication, {
    displayName: 'host.exe',
    executablePath: 'C:\\Apps\\host.exe',
  });
  assert.equal(hd.window.executablePath, 'C:\\x\\MSEdgeWebView2.exe', 'paths exposed by policy');

  const hidden = sanitizeDesktopToolError(
    ctx(base),
    's1',
    refused({ hostApplication: { executablePath: 'C:\\Apps\\host.exe' }, gateRule: 7 }),
  );
  const xd = hidden.details as any;
  assert.deepEqual(xd.verifiedHostApplication, { displayName: 'host.exe' });
  assert.equal(xd.accessRequestAvailable, false, 'no window id means nothing to request');
  assert.equal('gateRule' in xd, false);

  const deny = sanitizeDesktopToolError(
    ctx({ ...base, mode: 'denylist' }),
    's1',
    refused({ window: { windowId: 'w1', title: 'T' }, gateRule: 'refused by allowlist' }),
  );
  assert.equal((deny.details as any).accessRequestAvailable, false);
});

test('other desktop errors omit the access flag and count redactions', () => {
  const error = sanitizeDesktopToolError(
    ctx(base),
    's1',
    new AevraToolError('DESKTOP_UNAVAILABLE', `failed near ${shaped}`, {
      window: { windowId: 'w1', title: `title ${shaped}` },
      hostApplication: { executablePath: 42 },
    }),
  );
  const d = error.details as any;
  assert.equal('accessRequestAvailable' in d, false);
  assert.ok(d.redactionCount >= 2);
  assert.equal(error.message.includes(shaped), false);
  assert.equal(d.window.title.includes(shaped), false);
  assert.equal('verifiedHostApplication' in d, false);
});

test('redactWindow and redactNode scan names, values and children', () => {
  const tally = { count: 0 };
  const w = redactWindow({ windowId: 'w', title: 'Plain' } as any, tally, base as any);
  assert.equal('processName' in w, false);
  assert.equal(w.executablePath, undefined);
  const node: any = redactNode(
    {
      ref: 'n1',
      role: 'group',
      name: 'Parent',
      children: [{ ref: 'n2', role: 'edit', name: 'Field', value: shaped }],
    } as any,
    tally,
  );
  assert.equal(node.children[0].value.includes(shaped), false);
  assert.equal('value' in node, false);
  assert.equal(tally.count, 1);
});

test('targetOf prefers process name, then executable path, then a placeholder', () => {
  assert.equal(targetOf({ processName: 'a.exe', executablePath: 'b' } as any), 'a.exe');
  assert.equal(targetOf({ executablePath: 'C:\\b.exe' } as any), 'C:\\b.exe');
  assert.equal(targetOf(null), 'unknown-window');
  assert.equal(targetOf(undefined), 'unknown-window');
});
