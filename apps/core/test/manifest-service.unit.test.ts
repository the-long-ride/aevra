import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ManifestService } from '../src/workspaces/manifest-service.js';

function withTempDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'aevra-manifest-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a null workspace root returns defaults with no self-protection pattern', () => {
  const result = new ManifestService().read(null);
  assert.deepEqual(result, { commands: {}, protectedPatterns: [], warning: null });
});

test('a missing aevra.json returns defaults plus the implicit self-protection pattern', () => {
  withTempDir((dir) => {
    const result = new ManifestService().read(dir);
    assert.deepEqual(result.commands, {});
    assert.equal(result.warning, null);
    assert.equal(result.protectedPatterns.length, 1);
    assert.equal(result.protectedPatterns[0]!.class, 'SENSITIVE');
    assert.equal(result.protectedPatterns[0]!.pattern.test('aevra.json'), true);
  });
});

test('a valid manifest is parsed with secret patterns before sensitive, plus self-protection last', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'aevra.json'),
      JSON.stringify({
        commands: { test: 'pnpm test' },
        protectedPaths: { sensitive: ['*.local.*'], secret: ['vendor/keys/**'] },
      }),
    );
    const result = new ManifestService().read(dir);
    assert.deepEqual(result.commands, { test: 'pnpm test' });
    assert.equal(result.warning, null);
    assert.equal(result.protectedPatterns.length, 3);
    assert.equal(result.protectedPatterns[0]!.class, 'SECRET');
    assert.equal(result.protectedPatterns[1]!.class, 'SENSITIVE');
    assert.equal(result.protectedPatterns[2]!.class, 'SENSITIVE');
    assert.equal(result.protectedPatterns[0]!.pattern.test('vendor/keys/id_rsa'), true);
    assert.equal(result.protectedPatterns[1]!.pattern.test('a.local.json'), true);
  });
});

test('malformed JSON produces a warning and falls back to just self-protection', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'aevra.json'), '{ not valid json');
    const result = new ManifestService().read(dir);
    assert.deepEqual(result.commands, {});
    assert.equal(result.protectedPatterns.length, 1);
    assert.equal(result.protectedPatterns[0]!.pattern.test('aevra.json'), true);
    assert.match(result.warning ?? '', /could not be parsed/i);
  });
});

test('one bad glob among good ones is dropped and named, the rest survive', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'aevra.json'),
      JSON.stringify({ protectedPaths: { sensitive: ['', 'good/*'] } }),
    );
    const result = new ManifestService().read(dir);
    // 'good/*' plus the implicit self-protection pattern.
    assert.equal(result.protectedPatterns.length, 2);
    assert.equal(result.protectedPatterns[0]!.pattern.test('good/thing'), true);
    assert.match(result.warning ?? '', /pattern/i);
  });
});

test('a file over the size cap is a warning, not a thrown error, plus self-protection', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'aevra.json'),
      JSON.stringify({ commands: {} }) + ' '.repeat(300_000),
    );
    const result = new ManifestService().read(dir);
    assert.deepEqual(result.commands, {});
    assert.equal(result.protectedPatterns.length, 1);
    assert.match(result.warning ?? '', /exceeds/i);
  });
});

test('summarize reports counts instead of the compiled patterns', () => {
  withTempDir((dir) => {
    writeFileSync(
      path.join(dir, 'aevra.json'),
      JSON.stringify({
        commands: { build: 'pnpm build' },
        protectedPaths: { sensitive: ['a', 'b'], secret: ['c'] },
      }),
    );
    const summary = new ManifestService().summarize(dir);
    assert.deepEqual(summary.commands, { build: 'pnpm build' });
    // sensitive: 'a', 'b' plus the implicit self-protection pattern = 3.
    assert.deepEqual(summary.protectedPathsSummary, { sensitive: 3, secret: 1 });
    assert.equal(summary.warning, null);
  });
});

test('a second read with an unchanged file returns the cached result object', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'aevra.json'), JSON.stringify({ commands: { test: 'a' } }));
    const service = new ManifestService();
    const first = service.read(dir);
    const second = service.read(dir);
    assert.equal(first, second);
  });
});

test('a read after the file changes re-parses instead of returning the cache', () => {
  withTempDir((dir) => {
    const file = path.join(dir, 'aevra.json');
    writeFileSync(file, JSON.stringify({ commands: { test: 'a' } }));
    const service = new ManifestService();
    const first = service.read(dir);
    assert.deepEqual(first.commands, { test: 'a' });

    writeFileSync(file, JSON.stringify({ commands: { test: 'b' } }));
    const future = new Date(Date.now() + 5000);
    utimesSync(file, future, future);
    const second = service.read(dir);
    assert.deepEqual(second.commands, { test: 'b' });
  });
});
