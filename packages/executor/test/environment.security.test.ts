import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommand } from '../src/commands.js';

test('child environment excludes unrelated parent secrets', async () => {
  const previous = process.env.AEVRA_TEST_PARENT_SECRET;
  process.env.AEVRA_TEST_PARENT_SECRET = 'synthetic-parent-secret';
  try {
    const result = await runCommand({
      executable: process.execPath,
      args: [
        '-e',
        "process.stdout.write(process.env.AEVRA_TEST_PARENT_SECRET === undefined ? 'missing' : 'leaked')",
      ],
      env: {},
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'missing');
  } finally {
    if (previous === undefined) delete process.env.AEVRA_TEST_PARENT_SECRET;
    else process.env.AEVRA_TEST_PARENT_SECRET = previous;
  }
});

test('explicit child environment remains available without inheriting arbitrary parent values', async () => {
  const result = await runCommand({
    executable: process.execPath,
    args: [
      '-e',
      "process.exit(process.env.AEVRA_EXPLICIT_VALUE === 'expected-value' ? 0 : 7)",
    ],
    env: { AEVRA_EXPLICIT_VALUE: 'expected-value' },
  });
  assert.equal(result.exitCode, 0);
});
