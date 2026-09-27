import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceLockCoordinator } from '../src/policy/workspace-locks.js';

const req = (id: string, effect: string, outputKeys: string[] = [], workspaceId = 'ws') =>
  ({ operationId: id, sessionId: 's', workspaceId, effect, outputKeys }) as any;

/** True when the second request is granted immediately while the first is held. */
async function coexists(a: any, b: any) {
  const locks = new WorkspaceLockCoordinator();
  const held = await locks.acquire(a);
  let waited = false;
  const second = locks.acquire(b, () => {
    waited = true;
    held.release();
  });
  (await second).release();
  return !waited;
}

test('lock conflicts follow workspace, read-only, and build-output rules', async () => {
  assert.equal(await coexists(req('a', 'SOURCE_MUTATION'), req('b', 'SOURCE_MUTATION', [], 'other')), true);
  assert.equal(await coexists(req('a', 'READ_ONLY'), req('b', 'READ_ONLY')), true);
  assert.equal(await coexists(req('a', 'BUILD_OUTPUT', ['dist']), req('b', 'READ_ONLY')), true);
  assert.equal(await coexists(req('a', 'READ_ONLY'), req('b', 'BUILD_OUTPUT', ['dist'])), true);
  assert.equal(await coexists(req('a', 'BUILD_OUTPUT', ['dist']), req('b', 'BUILD_OUTPUT', ['out'])), true);
  assert.equal(await coexists(req('a', 'BUILD_OUTPUT', ['dist']), req('b', 'BUILD_OUTPUT', ['dist'])), false);
  assert.equal(await coexists(req('a', 'READ_ONLY'), req('b', 'SOURCE_MUTATION')), false);
  assert.equal(await coexists(req('a', 'SOURCE_MUTATION'), req('b', 'BUILD_OUTPUT', ['dist'])), false);
});

test('a waiting lock without an onWait callback proceeds after release', async () => {
  const locks = new WorkspaceLockCoordinator();
  const held = await locks.acquire(req('a', 'SOURCE_MUTATION'));
  const pending = locks.acquire(req('b', 'SOURCE_MUTATION'));
  setTimeout(() => held.release(), 10);
  const second = await pending;
  second.release();
  const third = await locks.acquire(req('c', 'SOURCE_MUTATION'));
  third.release();
});
