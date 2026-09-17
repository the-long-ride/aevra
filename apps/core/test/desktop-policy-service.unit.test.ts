import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopPolicyService } from '../src/desktop/desktop-policy-service.js';
import { defaultDesktopPolicy } from '../../../packages/security/src/desktop-policy-defaults.js';

function fakeSettings(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    get: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
    set: (key: string, value: unknown) => void store.set(key, value),
    read: (key: string) => store.get(key),
  };
}

test('the default policy is the same fail-closed denylist mcp-tools falls back to', () => {
  const service = new DesktopPolicyService(fakeSettings());
  assert.deepEqual(service.snapshot(), defaultDesktopPolicy());
});

test('an update persists and is reflected in the next snapshot', () => {
  const settings = fakeSettings();
  const service = new DesktopPolicyService(settings);
  service.update({ mode: 'allowlist', applications: ['notepad.exe'] });
  assert.equal(service.snapshot().mode, 'allowlist');
  assert.deepEqual(service.snapshot().applications, ['notepad.exe']);
  assert.equal((settings.read('desktop.policy') as { mode: string }).mode, 'allowlist');
});

test('a partial update preserves fields it did not touch', () => {
  const service = new DesktopPolicyService(fakeSettings());
  service.update({ mode: 'allowlist', applications: ['notepad.exe'] });
  service.update({ exposeExecutablePaths: true });
  const snapshot = service.snapshot();
  assert.equal(snapshot.mode, 'allowlist');
  assert.deepEqual(snapshot.applications, ['notepad.exe']);
  assert.equal(snapshot.exposeExecutablePaths, true);
});

test('switching to allowlist does not reuse the denylist as the allowed set', () => {
  // The shipped default is a DENYlist of terminals, password managers and the
  // UAC consent dialog. Carrying that array across a mode change would turn it
  // into the only set of apps the agent may drive - the exact reverse of what
  // "only these apps" asks for - so an allowlist starts empty and fails closed.
  const service = new DesktopPolicyService(fakeSettings());
  const denied = service.snapshot().applications;
  assert.ok(denied.includes('cmd.exe'));
  assert.ok(denied.includes('1Password.exe'));
  const after = service.update({ mode: 'allowlist' });
  assert.equal(after.mode, 'allowlist');
  assert.deepEqual(after.applications, []);
});

test('switching back to denylist restores the built-in sensitive-app list', () => {
  const service = new DesktopPolicyService(fakeSettings());
  service.update({ mode: 'allowlist' });
  service.update({ applications: ['notepad.exe'] });
  const after = service.update({ mode: 'denylist' });
  assert.deepEqual(after.applications, defaultDesktopPolicy().applications);
});

test('an explicit application list still wins over the mode-change baseline', () => {
  const service = new DesktopPolicyService(fakeSettings());
  const after = service.update({ mode: 'allowlist', applications: ['notepad.exe'] });
  assert.deepEqual(after.applications, ['notepad.exe']);
});

test('case-insensitive duplicate applications collapse to one entry', () => {
  const service = new DesktopPolicyService(fakeSettings());
  const after = service.update({
    mode: 'allowlist',
    applications: ['1Password.exe', '1password.exe', '  ', 'notepad.exe'],
  });
  assert.deepEqual(after.applications, ['1Password.exe', 'notepad.exe']);
});

test('a non-string application entry is still rejected rather than sanitized away', () => {
  const service = new DesktopPolicyService(fakeSettings());
  assert.throws(
    () => service.update({ applications: ['ok.exe', 42 as never] }),
    /desktop policy/i,
  );
});

test('an invalid mode is rejected rather than stored', () => {
  const service = new DesktopPolicyService(fakeSettings());
  assert.throws(() => service.update({ mode: 'open-season' as never }), /desktop policy/i);
});

test('a stored value that is no longer valid falls back to the default', () => {
  const settings = fakeSettings({ 'desktop.policy': { mode: 'sometimes' } });
  const service = new DesktopPolicyService(settings);
  assert.equal(service.snapshot().mode, 'denylist');
});
