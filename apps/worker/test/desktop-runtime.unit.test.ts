import assert from 'node:assert/strict';
import test from 'node:test';
import { DesktopRuntime, resolveHelperBinaryPath } from '../src/desktop-runtime.js';

const BUNDLED = '/pkg/dist/helper/win32-x64/aevra-desktop-helper.exe';
const CARGO = '/repo/helper/target/release/aevra-desktop-helper.exe';
const CANDIDATES = [BUNDLED, CARGO];
const MISSING_OVERRIDE = '/stale/location/aevra-desktop-helper.exe';
const PRESENT_OVERRIDE = '/custom/aevra-desktop-helper.exe';

function resolveWith(env: Record<string, string>, present: string[]) {
  const warnings: string[] = [];
  const result = resolveHelperBinaryPath({
    env,
    exists: (path) => present.includes(path),
    candidates: CANDIDATES,
    warn: (message) => warnings.push(message),
  });
  return { result, warnings };
}

test('a missing override falls back to the bundled helper and warns', () => {
  const { result, warnings } = resolveWith({ AEVRA_DESKTOP_HELPER_PATH: MISSING_OVERRIDE }, [
    BUNDLED,
  ]);
  assert.equal(result.path, BUNDLED);
  assert.equal(result.missingOverride, MISSING_OVERRIDE);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? '', /AEVRA_DESKTOP_HELPER_PATH/);
  assert.ok(warnings[0]?.includes(MISSING_OVERRIDE));
});

test('an existing override wins over the bundled helper', () => {
  const { result, warnings } = resolveWith({ AEVRA_DESKTOP_HELPER_PATH: PRESENT_OVERRIDE }, [
    PRESENT_OVERRIDE,
    BUNDLED,
  ]);
  assert.equal(result.path, PRESENT_OVERRIDE);
  assert.equal(result.missingOverride, undefined);
  assert.deepEqual(warnings, []);
});

test('an empty or whitespace override is treated as unset', () => {
  for (const value of ['', '   ']) {
    const { result, warnings } = resolveWith({ AEVRA_DESKTOP_HELPER_PATH: value }, [BUNDLED]);
    assert.equal(result.path, BUNDLED);
    assert.equal(result.missingOverride, undefined);
    assert.deepEqual(result.checked, [BUNDLED]);
    assert.deepEqual(warnings, []);
  }
});

test('the bundled helper is found when no override is set', () => {
  const { result } = resolveWith({}, [BUNDLED]);
  assert.equal(result.path, BUNDLED);
  assert.deepEqual(result.checked, [BUNDLED]);
});

test('the Cargo build is used when no bundled helper exists', () => {
  const { result } = resolveWith({}, [CARGO]);
  assert.equal(result.path, CARGO);
});

test('nothing found reports every checked path including the missing override', () => {
  const { result } = resolveWith({ AEVRA_DESKTOP_HELPER_PATH: MISSING_OVERRIDE }, []);
  assert.equal(result.path, undefined);
  assert.deepEqual(result.checked, [MISSING_OVERRIDE, ...CANDIDATES]);
});

test('DESKTOP_HELPER_NOT_INSTALLED lists checked paths and names the stale override', async () => {
  const runtime = new DesktopRuntime(() => ({
    path: undefined,
    checked: [MISSING_OVERRIDE, ...CANDIDATES],
    missingOverride: MISSING_OVERRIDE,
  }));
  await assert.rejects(
    () => runtime.registry().connect(),
    (error: Error & { details?: Record<string, unknown> }) => {
      assert.match(error.message, /DESKTOP_HELPER_NOT_INSTALLED/);
      assert.ok(error.message.includes(MISSING_OVERRIDE));
      assert.ok(error.message.includes(BUNDLED));
      assert.deepEqual(error.details?.checkedPaths, [MISSING_OVERRIDE, ...CANDIDATES]);
      assert.equal(error.details?.missingOverride, MISSING_OVERRIDE);
      return true;
    },
  );
});
