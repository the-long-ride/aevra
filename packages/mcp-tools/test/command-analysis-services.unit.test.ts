import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { CapabilityRoot } from '../../protocol/src/command-analysis.js';
import { createAnalysisServices } from '../src/command-analysis-services.js';

const platform =
  process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux';

const hostCtx: any = {
  actor: 'operator',
  sessionId: 's1',
  workspaceId: 'w1',
  platform,
  backendId: 'host',
};

function commandRoot(hostRoot: string): CapabilityRoot {
  return {
    kind: 'workspace' as const,
    id: 'root',
    logicalPrefix: '/',
    hostRoot,
    capabilities: ['commands.run'],
  };
}

test('analysis services cover empty-root and negative config guards on Windows semantics', async () => {
  const services = createAnalysisServices(undefined, [], 'win32');
  const winCtx = { ...hostCtx, platform: 'win32' };

  assert.equal((await services.canonicalizeCwd?.('C:\\work', winCtx))?.scope, 'unknown');
  assert.equal(
    (await services.canonicalize('child.txt', 'C:\\work', 'read', winCtx)).scope,
    'unknown',
  );
  assert.equal(await services.readConfig('package.json', -1, winCtx), null);
});

test('analysis services fail closed when an authorized root cannot be canonicalized', async () => {
  const missingRoot = path.join(tmpdir(), `aevra-missing-root-${Date.now()}`);
  const services = createAnalysisServices(undefined, [commandRoot(missingRoot)], platform);

  const result = await services.canonicalizeCwd?.('/', hostCtx);
  assert.equal(result?.scope, 'unknown');
  assert.equal(result?.reasons[0]?.code, 'DYNAMIC_SCOPE');
});

test('analysis services cover relative, absolute, containment, and byte-bound config branches', async () => {
  const tempDir = path.join(tmpdir(), `aevra-analysis-services-${Date.now()}`);
  const outsideDir = path.join(tmpdir(), `aevra-analysis-services-out-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });
  const insideConfig = path.join(tempDir, 'package.json');
  const outsideConfig = path.join(outsideDir, 'package.json');
  writeFileSync(insideConfig, '{"name":"inside"}');
  writeFileSync(outsideConfig, '{"name":"outside"}');

  try {
    const noWorkspace = createAnalysisServices(undefined, [commandRoot(tempDir)], platform);
    assert.equal(await noWorkspace.readConfig('package.json', 1024, hostCtx), null);

    const services = createAnalysisServices(tempDir, [commandRoot(tempDir)], platform);
    const absolute = await services.readConfig(insideConfig, 1024, hostCtx);
    assert.equal(absolute?.text, '{"name":"inside"}');
    assert.ok(absolute?.fingerprint);

    assert.equal(await services.readConfig(outsideConfig, 1024, hostCtx), null);
    assert.equal(await services.readConfig(insideConfig, 0, hostCtx), null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('analysis services host resolver returns null for an unavailable executable', async () => {
  const tempDir = path.join(tmpdir(), `aevra-analysis-resolver-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const services = createAnalysisServices(tempDir, [commandRoot(tempDir)], platform);
    const identity = await services.resolveExecutable?.(
      '__aevra_missing_executable__',
      '/unmapped',
      hostCtx,
    );
    assert.equal(identity, null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
