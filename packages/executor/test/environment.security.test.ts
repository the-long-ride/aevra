import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChildEnvironment } from '../src/environment.js';
import { runCommand } from '../src/commands.js';
import { ManagedProcessRuntime } from '../src/processes.js';

async function until(predicate: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition not met');
}

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
    args: ['-e', "process.exit(process.env.AEVRA_EXPLICIT_VALUE === 'expected-value' ? 0 : 7)"],
    env: { AEVRA_EXPLICIT_VALUE: 'expected-value' },
  });
  assert.equal(result.exitCode, 0);
});

test('attached managed process excludes unrelated parent secrets', async () => {
  const previous = process.env.AEVRA_TEST_PARENT_SECRET;
  process.env.AEVRA_TEST_PARENT_SECRET = 'synthetic-parent-secret';
  const runtime = new ManagedProcessRuntime();
  try {
    const started = runtime.start(
      {
        executable: process.execPath,
        args: [
          '-e',
          "console.log(process.env.AEVRA_TEST_PARENT_SECRET === undefined ? 'missing' : 'leaked')",
        ],
        env: {},
      },
      process.cwd(),
      'stop-with-aevra',
    );
    await until(() => runtime.logs(started.processId).eof);
    const logs = runtime.logs(started.processId);
    assert.deepEqual(logs.lines, ['missing']);
  } finally {
    if (previous === undefined) delete process.env.AEVRA_TEST_PARENT_SECRET;
    else process.env.AEVRA_TEST_PARENT_SECRET = previous;
  }
});

test('tool child env may opt into execution-essential keys without ambient secret inheritance', () => {
  const built = buildChildEnvironment(
    { EXPLICIT: 'yes' },
    {
      PATH: '/usr/bin',
      HOME: '/home/test',
      DOCKER_HOST: 'unix:///run/user/1000/docker.sock',
      RANDOM_PARENT_SECRET: 'nope',
    },
    'linux',
    ['DOCKER_HOST'],
  );
  assert.equal(built.PATH, '/usr/bin');
  assert.equal(built.HOME, '/home/test');
  assert.equal(built.DOCKER_HOST, 'unix:///run/user/1000/docker.sock');
  assert.equal(built.EXPLICIT, 'yes');
  assert.equal('RANDOM_PARENT_SECRET' in built, false);
});
