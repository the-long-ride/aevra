import assert from 'node:assert/strict';
import test from 'node:test';
async function policy() {
  try {
    return await import('../src/policy/command-matcher.js');
  } catch {
    return {} as any;
  }
}

test('command matcher wildcards paths filenames and parameter values', async () => {
  const { commandPermissionMatcher } = await policy();
  assert.equal(typeof commandPermissionMatcher, 'function', 'commandPermissionMatcher must exist');
  assert.equal(commandPermissionMatcher(['git', 'diff', 'src/app.ts']), 'git:diff:*');
  assert.equal(
    commandPermissionMatcher([
      'dotnet',
      'test',
      'tests/Aevra.Tests.csproj',
      '--filter',
      'Category=Fast',
    ]),
    'dotnet:test:*:--filter:*',
  );
  assert.equal(commandPermissionMatcher(['npm', 'test', '--', '--runInBand']), 'npm:test:--:*');
  assert.equal(commandPermissionMatcher(['cargo', 'test', 'worker_manager']), 'cargo:test:*');
});

test('command matcher keeps option names and never stores shell script text', async () => {
  const { commandPermissionMatcher } = await policy();
  assert.equal(typeof commandPermissionMatcher, 'function', 'commandPermissionMatcher must exist');
  assert.equal(commandPermissionMatcher(['git', 'status', '--short']), 'git:status:--short');
  assert.equal(
    commandPermissionMatcher(
      [
        'powershell.exe',
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-Content secret.txt',
      ],
      { shell: 'powershell' },
    ),
    'shell:powershell:*',
  );
  assert.equal(
    commandPermissionMatcher(['bash', '-lc', 'cat ./secret.txt'], { shell: 'bash' }),
    'shell:bash:*',
  );
});

test('host fallback commands use a distinct remembered matcher', async () => {
  const { commandPermissionMatcher } = await policy();
  assert.equal(commandPermissionMatcher(['npm', 'test'], { executionMode: 'sandbox' }), 'npm:test');
  assert.equal(
    commandPermissionMatcher(['npm', 'test'], { executionMode: 'host' }),
    'npm:test:host-fallback',
  );
  assert.equal(
    commandPermissionMatcher(['powershell.exe', '-Command', 'Get-Content secret.txt'], {
      shell: 'powershell',
      executionMode: 'host',
    }),
    'shell:powershell:*:host-fallback',
  );
});

test('every unremembered command matcher requires approval regardless of risk', async () => {
  const { needsCommandPermissionApproval } = await policy();
  assert.equal(
    typeof needsCommandPermissionApproval,
    'function',
    'needsCommandPermissionApproval must exist',
  );
  assert.equal(needsCommandPermissionApproval(undefined, false), true);
  assert.equal(needsCommandPermissionApproval('approval', false), true);
  assert.equal(needsCommandPermissionApproval('allow', false), false);
  assert.equal(needsCommandPermissionApproval('approval', true), false);
});
