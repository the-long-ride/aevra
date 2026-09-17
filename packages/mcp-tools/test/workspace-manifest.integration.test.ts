import assert from 'node:assert/strict';
import test from 'node:test';
import { handleBasicTool } from '../src/basic-tools.js';
import { workspaceResult } from '../src/service-helpers.js';

test('workspaceResult attaches an untrusted manifest when a summary is supplied', () => {
  const result: any = workspaceResult(
    { id: 'ws-1', name: 'Aevra', description: 'test workspace' },
    ['files.read'],
    {
      commands: { test: 'pnpm test' },
      protectedPathsSummary: { sensitive: 1, secret: 0 },
      warning: null,
    },
  );
  assert.deepEqual(result.manifest.commands, { test: 'pnpm test' });
  assert.deepEqual(result.manifest.protectedPathsSummary, { sensitive: 1, secret: 0 });
  assert.equal(result.manifest.untrusted, true);
});

test('workspaceResult omits manifest entirely when none is supplied', () => {
  const result = workspaceResult({ id: 'ws-1', name: 'Aevra', description: 'test' }, [
    'files.read',
  ]);
  assert.equal('manifest' in result, false);
});

function fakeContext(manifestSummary: any): any {
  const workspaceRecord = { id: 'ws-1', name: 'Aevra', description: '', hostRoot: '/repo' };
  return {
    sessions: {
      activeLease: () => ({ workspaceId: 'ws-1', capabilities: ['files.read'] }),
      get: () => ({ actor: 'connector:test', subject: 'test' }),
    },
    workspaces: {
      getLocal: () => workspaceRecord,
      listRemote: () => [{ id: 'ws-1', name: 'Aevra', description: '' }],
    },
    deps: { manifests: { summarize: () => manifestSummary } },
    oneTimeCapabilities: new Set(),
  };
}

test('workspace_current attaches manifest.commands for the single-lease case', async () => {
  const summary = {
    commands: { test: 'pnpm test' },
    protectedPathsSummary: { sensitive: 0, secret: 0 },
    warning: null,
  };
  const result: any = await handleBasicTool(
    fakeContext(summary),
    'sess-1',
    'workspace_current',
    {},
  );
  assert.deepEqual(result.manifest.commands, { test: 'pnpm test' });
  assert.equal(result.manifest.untrusted, true);
});
