import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { analyzeCommand } from '../src/analyze.js';
import type { AnalysisContext, CommandRequest } from '../src/types.js';

function makeContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    actor: 'test',
    sessionId: 's1',
    workspaceId: 'w1',
    rootsRevision: '1',
    platform: 'linux',
    backendId: 'host',
    backendRevision: '1',
    policyRevision: '1',
    environmentFingerprint: 'env',
    resolverGeneration: '1',
    ...overrides,
  };
}

test('analyzeCommand: handles custom services.parse', async () => {
  const customService = {
    parse: async () => ({
      status: 'partial' as const,
      nodes: [
        {
          id: 'n1',
          dialect: 'direct' as const,
          argv: ['custom'],
          wrappers: [],
          application: 'custom',
          operation: ['custom'],
          options: [],
          forwardedArgv: [],
          cwdCandidates: ['/'],
          modifiers: [],
          targets: [],
          effect: 'READ_ONLY',
          risk: 'LOW',
          scope: 'inside' as const,
          reasons: [],
        },
      ],
      edges: [],
      reasons: [],
    }),
    resolveExecutable: async () => null,
    canonicalize: async () => ({ scope: 'inside' as const, reasons: [] }),
    readConfig: async () => null,
  };

  const res = await analyzeCommand(
    { kind: 'argv', argv: ['custom'], executionMode: 'host' },
    makeContext(),
    customService,
  );
  assert.equal(res.nodes[0]?.application, 'custom');
  assert.equal(res.parseStatus, 'partial');
});

test('analyzeCommand: detects script size over budget', async () => {
  const largeScript = 'echo 1\n'.repeat(12000); // > 64 KiB
  const res = await analyzeCommand(
    { kind: 'script', script: largeScript, executionMode: 'host' },
    makeContext(),
  );
  assert.equal(res.parseStatus, 'unsupported');
  assert.ok(res.reasons.some((r) => r.code === 'ANALYSIS_LIMIT'));
});

test('analyzeCommand: handles empty argv and nested shells', async () => {
  // Empty argv
  const emptyRes = await analyzeCommand(
    { kind: 'argv', argv: [], executionMode: 'host' },
    makeContext(),
  );
  assert.equal(emptyRes.parseStatus, 'invalid');

  // Nested shell: bash -c "echo hello"
  const nestedRes = await analyzeCommand(
    { kind: 'argv', argv: ['bash', '-c', 'echo hello'], executionMode: 'host' },
    makeContext(),
  );
  assert.equal(nestedRes.nodes[0]?.application, 'bash');
  assert.equal(nestedRes.nodes[1]?.application, 'echo');

  // Nested shell with oversized script
  const largeNested = 'echo test\n'.repeat(12000);
  const largeNestedRes = await analyzeCommand(
    { kind: 'argv', argv: ['bash', '-c', largeNested], executionMode: 'host' },
    makeContext(),
  );
  assert.ok(largeNestedRes.reasons.some((r) => r.code === 'ANALYSIS_LIMIT'));
});

test('analyzeCommand: reads config for npm script fingerprints with --prefix', async () => {
  let requestedConfigPath = '';
  const services = {
    resolveExecutable: async (name: string) => ({
      logicalName: name,
      canonicalPath: `/usr/bin/${name}`,
      launcher: 'native' as const,
      fingerprint: `fp_${name}`,
      provenance: 'installed' as const,
      backendId: 'host',
    }),
    canonicalize: async (targetPath: string, cwd: string) => ({
      canonicalPath: path.posix.isAbsolute(targetPath)
        ? targetPath
        : path.posix.join(cwd, targetPath),
      scope: 'inside' as const,
      reasons: [],
    }),
    readConfig: async (configPath: string) => {
      requestedConfigPath = configPath;
      if (configPath.includes('package.json')) {
        return {
          text: JSON.stringify({ scripts: { build: 'tsc -p .' } }),
          fingerprint: 'pkg_fp_1',
        };
      }
      return null;
    },
  };

  const req: CommandRequest = {
    kind: 'argv',
    argv: ['npm', '--prefix', 'packages/core', 'run', 'build'],
    cwdLogical: '/repo',
    executionMode: 'host',
  };

  const res = await analyzeCommand(
    req,
    makeContext({
      workspaceRoot: '/repo',
      roots: [{ id: 'root', logicalPrefix: '/repo', hostRoot: '/repo' }],
    }),
    services,
  );
  assert.equal(requestedConfigPath.replaceAll('\\', '/'), '/repo/packages/core/package.json');
  assert.equal(res.nodes[0]?.application, 'npm');
  assert.equal(res.nodes[0]?.scriptName, 'build');
  assert.ok(res.nodes[0]?.scriptFingerprint);
  assert.equal(res.nodes[0]?.executable?.fingerprint, 'fp_npm');
});

test('analyzeCommand: bounds cwd alternatives and reports ANALYSIS_LIMIT', async () => {
  const nodes = Array.from({ length: 7 }, (_, index) => ({
    id: `n${index}`,
    dialect: 'bash' as const,
    argv: index < 6 ? ['cd', `d${index}`] : ['git', 'status'],
    wrappers: [],
    application: index < 6 ? 'builtin:cd' : 'git',
    operation: index < 6 ? ['cd', `d${index}`] : ['status'],
    options: [],
    forwardedArgv: [],
    cwdCandidates: [],
    modifiers: [],
    targets: [],
    effect: 'READ_ONLY',
    risk: 'LOW',
    scope: 'inside' as const,
    reasons: [],
  }));
  const edges = Array.from({ length: 6 }, (_, index) => ({
    from: `n${index}`,
    to: `n${index + 1}`,
    kind: 'sequence' as const,
  }));
  const services = {
    parse: async () => ({ status: 'complete' as const, nodes, edges, reasons: [] }),
    resolveExecutable: async () => null,
    canonicalize: async () => ({ scope: 'inside' as const, reasons: [] }),
    readConfig: async () => null,
  };

  const result = await analyzeCommand(
    { kind: 'script', script: 'synthetic', shell: 'bash', executionMode: 'host' },
    makeContext(),
    services,
  );

  assert.equal(result.parseStatus, 'unsupported');
  assert.equal(result.scope, 'unknown');
  assert.ok(result.reasons.some((reason) => reason.code === 'ANALYSIS_LIMIT'));
  assert.ok((result.nodes.at(-1)?.cwdCandidates.length ?? 0) <= 32);
});

test('analyzeCommand: robust against services throwing errors', async () => {
  const buggyServices = {
    resolveExecutable: async () => {
      throw new Error('resolve crash');
    },
    canonicalize: async () => ({ scope: 'inside' as const, reasons: [] }),
    readConfig: async () => {
      throw new Error('read crash');
    },
  };

  const res = await analyzeCommand(
    { kind: 'argv', argv: ['npm', 'run', 'test'], executionMode: 'host' },
    makeContext(),
    buggyServices as any,
  );
  assert.ok(res);
  assert.equal(res.nodes[0]?.application, 'npm');
});
