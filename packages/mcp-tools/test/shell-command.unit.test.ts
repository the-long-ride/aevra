import assert from 'node:assert/strict';
import test from 'node:test';
import { buildShellCommand, shellRiskFloor } from '../src/shell-command.js';

test('sandbox auto shell uses bash without shell interpolation in Node', () => {
  const command = buildShellCommand(
    {
      script: 'printf "%s\\n" "$PWD"',
      shell: 'auto',
      executionMode: 'sandbox',
      timeoutMs: 12_000,
      env: { A: 'B' },
    },
    'win32',
  );
  assert.equal(command.executable, 'bash');
  assert.deepEqual(command.args, ['-lc', 'printf "%s\\n" "$PWD"']);
  assert.equal(command.timeoutMs, 12_000);
  assert.deepEqual(command.env, { A: 'B' });
});

test('host auto shell resolves to native PowerShell on Windows', () => {
  const command = buildShellCommand(
    { script: 'Get-ChildItem', shell: 'auto', executionMode: 'host' },
    'win32',
  );
  assert.equal(command.executable, 'powershell.exe');
  assert.deepEqual(command.args, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Get-ChildItem',
  ]);
});

test('host auto shell resolves to bash on unix-like systems', () => {
  const command = buildShellCommand(
    { script: 'pwd', shell: 'auto', executionMode: 'host' },
    'linux',
  );
  assert.equal(command.executable, 'bash');
  assert.deepEqual(command.args, ['-lc', 'pwd']);
});

test('PowerShell is rejected in the current Linux strict sandbox image', () => {
  assert.throws(
    () =>
      buildShellCommand(
        { script: 'Get-ChildItem', shell: 'powershell', executionMode: 'sandbox' },
        'win32',
      ),
    (error: any) => error?.code === 'INVALID_REQUEST' && /host execution/.test(error.message),
  );
});

test('raw shell execution is always high risk', () => {
  assert.equal(shellRiskFloor('sandbox'), 'HIGH');
  assert.equal(shellRiskFloor('host'), 'HIGH');
});

test('commandTool validates command executable presence', async () => {
  const { commandTool } = await import('../src/command-tools.js');
  await assert.rejects(
    () => commandTool({} as any, 's1', { command: { executable: '' } }),
    /command executable is required/,
  );

  const baseCtx = (opts: any = {}) =>
    ({
      sessions: {
        get: () => ({ id: 's1', actor: 'user', subject: 'user' }),
        activeLease: () => ({ workspaceId: 'w1', capabilities: ['commands.run'] }),
        isYolo: () => false,
      },
      workspaces: { capabilityRoots: () => [] },
      oneTimeCapabilities: new Set(),
      deps: {
        permissions: {
          decide: () => opts.permissionDecision ?? { outcome: 'ask' },
        },
        operations: {
          runCommand: async () => 'command-executed',
        },
      },
      approvals: opts.approvals ?? {
        request: async () => ({
          status: opts.approvalStatus ?? 'approval_pending',
          requestId: 'req_1',
        }),
      },
    }) as any;

  // Deny outcome
  const denyCtx = baseCtx({
    permissionDecision: { outcome: 'deny', reason: 'Blocked by policy' },
  });
  await assert.rejects(
    () => commandTool(denyCtx, 's1', { executable: 'rm', args: ['-rf'] }),
    (e: any) => e.code === 'CAPABILITY_REQUIRED' && /Blocked by policy/.test(e.message),
  );

  // Missing approval service
  const noApprovalsCtx = baseCtx();
  noApprovalsCtx.approvals = undefined;
  await assert.rejects(
    () => commandTool(noApprovalsCtx, 's1', { executable: 'node', args: ['-v'] }),
    (e: any) => e.code === 'APPROVAL_PENDING',
  );
});
