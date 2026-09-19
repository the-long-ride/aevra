import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { HelperProcess, parseHelperError } from '../src/helper-process.js';

const SCRIPT = fileURLToPath(new URL('./fake-helper.js', import.meta.url));

function helper(mode: string, deadlineMs = 1000) {
  return new HelperProcess({ command: process.execPath, args: [SCRIPT, mode], deadlineMs });
}

test('a call round-trips through line-delimited JSON', async () => {
  const process_ = helper('normal');
  assert.deepEqual(await process_.call('describe', {}), { echo: 'describe' });
  process_.kill();
});

test('a helper that never answers fails with DESKTOP_TIMEOUT', async () => {
  const process_ = helper('slow', 150);
  await assert.rejects(() => process_.call('describe', {}), /DESKTOP_TIMEOUT/);
  process_.kill();
});

test('malformed output does not wedge later calls', async () => {
  const process_ = helper('garbage', 150);
  // The unparseable line tells us nothing, so the call it belonged to is left to
  // its deadline rather than guessed at.
  await assert.rejects(() => process_.call('describe', {}), /DESKTOP_TIMEOUT/);
  // The supervisor must still be usable afterwards: a fresh helper answers.
  const revived = helper('normal');
  assert.deepEqual(await revived.call('windows', {}), { echo: 'windows' });
  revived.kill();
  process_.kill();
});

test('death mid-call reports DESKTOP_DRIVER_DIED and bumps the generation', async () => {
  const process_ = helper('die-on-second');
  const before = process_.generation();
  await process_.call('first', {});
  await assert.rejects(() => process_.call('second', {}), /DESKTOP_DRIVER_DIED/);
  // Refs are namespaced by generation, so a ref minted before the restart can
  // never resolve afterwards. Silently reusing one clicks the wrong thing.
  assert.ok(process_.generation() > before);
  process_.kill();
});

test('reusing one instance after death spawns a fresh child and stays usable', async () => {
  const process_ = helper('die-on-second');
  const before = process_.generation();
  assert.deepEqual(await process_.call('first', {}), { echo: 'first' });
  await assert.rejects(() => process_.call('second', {}), /DESKTOP_DRIVER_DIED/);
  // The SAME instance, called again, must spawn a fresh child rather than
  // leaving the dead one's late events able to orphan or tear down the new one.
  assert.deepEqual(await process_.call('third', {}), { echo: 'third' });
  assert.ok(process_.generation() > before);
  process_.kill();
});

test('a live replacement child is not torn down by its dead predecessor late exit', async () => {
  // Reproduces the exact race from the Task 5 review finding: a timeout kills
  // child A (an async OS-level kill, not an immediate exit). The caller, in
  // the very next microtask, issues a fresh call, which spawns child B before
  // A's real 'exit' event has been delivered. If the handlers registered in
  // start() are not gated on the child instance, A's late exit calls fail()
  // again and wrongly rejects B's still-pending, still-alive call.
  //
  // Both calls share one HelperProcess instance, so they share one deadlineMs
  // (50ms here) -- the second call's OWN timeout also fires around 50ms.
  // "Did it settle by some fixed real-time mark" therefore cannot discriminate
  // the bug from correct behaviour: both settle quickly. The discriminator is
  // WHY it settled -- a correct implementation rejects with DESKTOP_TIMEOUT
  // (its own deadline); the bug rejects with DESKTOP_DRIVER_DIED (torn down
  // by a predecessor that isn't even the current child anymore).
  //
  // Now that start()'s handlers are fenced by child identity (Finding 1's
  // fix), kill() always reaches the current child, so this test cannot
  // orphan a live process the way an earlier version of it once could. A
  // bound is kept only so a genuine regression fails as an ordinary test
  // failure instead of hanging the runner.
  const process_ = helper('slow', 50);
  try {
    await assert.rejects(() => process_.call('first', {}), /DESKTOP_TIMEOUT/);

    const second = process_.call('second', {});
    const settled = second.then(
      (value: unknown) => value,
      (error: unknown) => error,
    );

    const BOUND_MS = 2000;
    let boundTimer!: NodeJS.Timeout;
    const bound = new Promise<'bound'>((resolve) => {
      boundTimer = setTimeout(() => resolve('bound'), BOUND_MS);
    });

    const outcome = await Promise.race([settled, bound]);
    clearTimeout(boundTimer);

    assert.notEqual(
      outcome,
      'bound',
      `the replacement child's call did not settle within ${BOUND_MS}ms -- this most likely means \`` +
        "HelperProcess's replacement child never got a chance to settle. A very slow or heavily " +
        'loaded machine can also trip this bound, so rule that out first before suspecting the fix.',
    );

    assert.ok(
      outcome instanceof Error && /DESKTOP_TIMEOUT/.test(outcome.message),
      "expected the replacement child's own deadline to fire (DESKTOP_TIMEOUT); got: " +
        `${String(outcome)} -- a DESKTOP_DRIVER_DIED here means the live child was wrongly torn ` +
        "down by its dead predecessor's late exit event (Finding 1).",
    );
  } finally {
    process_.kill();
  }
});

test('parseHelperError parses string legacy errors into DESKTOP_HELPER', () => {
  const parsed = parseHelperError('legacy failure');
  assert.equal(parsed.code, 'DESKTOP_HELPER');
  assert.equal(parsed.message, 'legacy failure');
});

test('parseHelperError accepts structured allowlisted codes and preserves safe details', () => {
  const parsed = parseHelperError({
    code: 'DESKTOP_REF_STALE',
    message: 'Expired',
    details: { ref: 'ref_123', windowId: 'win_1', secret: 'ignore-me' },
  });
  assert.equal(parsed.code, 'DESKTOP_REF_STALE');
  assert.equal(parsed.message, 'Expired');
  assert.deepEqual(parsed.details, { ref: 'ref_123', windowId: 'win_1' });
});

test('parseHelperError maps unallowlisted codes to DESKTOP_HELPER', () => {
  const parsed = parseHelperError({
    code: 'SOME_RANDOM_CODE',
    message: 'Something broke',
  });
  assert.equal(parsed.code, 'DESKTOP_HELPER');
  assert.equal(parsed.message, 'Something broke');
});

test('normalizeBackgroundCapability requires literal boolean true', async () => {
  const { normalizeBackgroundCapability } = await import('../src/background-driver.js');
  assert.equal(normalizeBackgroundCapability({ input: true } as any), false);
  assert.equal(normalizeBackgroundCapability({ backgroundActions: true }), true);
  assert.equal(normalizeBackgroundCapability({ backgroundActions: 'true' } as any), false);
  assert.equal(normalizeBackgroundCapability(null), false);
  assert.equal(normalizeBackgroundCapability(undefined), false);
});
