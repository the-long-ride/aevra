import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ChangeSetService } from '../src/changes/change-service.js';

function service(calls: any[]) {
  const worker: any = { execute: async (input: any) => (calls.push(input), { ok: true }) };
  const workspaces: any = { capabilityRoots: () => [] };
  return new ChangeSetService({} as any, {} as any, workspaces, worker, path.resolve('/rec'));
}

test('discardSnapshot sends only paths inside the recovery dir to the worker', async () => {
  const calls: any[] = [];
  const changes = service(calls);
  await changes.discardSnapshot('s', 'w', path.resolve('/rec/w/c1/snapshots/op.before'));
  await changes.discardSnapshot('s', 'w', path.resolve('/elsewhere/file.before'));
  await changes.discardSnapshot('s', 'w', path.resolve('/rec-other/file.before'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation.kind, 'recovery.discard');
});
