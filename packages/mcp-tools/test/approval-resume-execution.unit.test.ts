import assert from 'node:assert/strict';
import test from 'node:test';
import { resumeApproval } from '../src/approval-resume.js';

function ticket(tool: string, args: any = {}, overrides: any = {}) {
  return {
    id: 'req1',
    actor: 'oauth:ChatGPT',
    sessionId: 's1',
    workspaceId: 'w1',
    operation: { family: 'files:write', capability: 'files.write', risk: 'HIGH', argsHash: 'x' },
    payload: { tool, args },
    expectedState: {},
    risk: 'HIGH',
    state: 'APPROVED',
    expiresAt: 'later',
    decisionScope: 'once',
    ...overrides,
  };
}

function fixture(t: any, options: any = {}) {
  const calls: any[] = [];
  const lease = {
    workspaceId: 'w1',
    capabilities: ['files.write', 'files.delete', 'git.commit', 'git.push'],
  };
  const session = { id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' };
  const context: any = {
    sessions: {
      get: () => session,
      activeLease: () => lease,
      leases: () => [lease],
      leaseForWorkspace: () => lease,
      connectionIdentity: () => ({ actor: session.actor, subject: session.subject }),
      grantConnectionWorkspace: () =>
        options.grantResult === undefined
          ? { workspaceId: 'w1', capabilities: ['files.read'] }
          : options.grantResult,
      switchWorkspace: async () =>
        options.switchResult ?? {
          status: 'admitted',
          lease: { workspaceId: 'w1', capabilities: ['files.read'] },
        },
    },
    workspaces: {
      getLocal: (id: string) =>
        options.workspaceMissing
          ? null
          : { id, name: 'One', description: 'desc', hostRoot: '/host' },
      capabilityRoots: () => [],
    },
    worker: {
      execute: async (input: any) => {
        calls.push(['worker', input]);
        return options.workerFailure
          ? {
              ok: false,
              error: {
                code: 'INVALID_REQUEST',
                message: 'worker failed',
                details: { kind: input.operation.kind },
              },
            }
          : { ok: true, value: { kind: input.operation.kind } };
      },
    },
    reads: {},
    approvals: {
      status: () => t,
      resume: async (_id: string, validate: any, execute: any) => {
        const checked = await validate(t);
        return checked.ok ? execute(t) : checked;
      },
    },
    deps: {
      operations: {
        runCommand: async (...args: any[]) => {
          calls.push(['runCommand', ...args]);
          return { command: true };
        },
        delete: async (...args: any[]) => {
          calls.push(['delete', ...args]);
          return { deleted: true };
        },
      },
      changes: {
        rollback: async (...args: any[]) => {
          calls.push(['rollback', ...args]);
          return { rollback: true };
        },
      },
      skills: {
        write: (...args: any[]) => {
          calls.push(['skillWrite', ...args]);
          return { skill: true };
        },
        writeInstructions: (...args: any[]) => {
          calls.push(['instructionWrite', ...args]);
          return { instructions: true };
        },
      },
    },
    oneTimeCapabilities: new Set<string>(),
    processStart: async (...args: any[]) => {
      calls.push(['processStart', ...args]);
      return { process: true };
    },
    callInner: async (...args: any[]) => {
      calls.push(['callInner', ...args]);
      return { replayed: args[1] };
    },
  };
  return { context, calls };
}

test('frozen workspace select covers connection grant switch defaults and admission failures', async () => {
  const connection = ticket(
    'workspace_select',
    { workspaceId: 'w1' },
    {
      operation: {
        family: 'workspace:select',
        capability: 'files.read',
        risk: 'MEDIUM',
        argsHash: 'x',
      },
      decisionScope: 'connection',
    },
  );
  const selected: any = await resumeApproval(fixture(connection).context, 's1', 'req1');
  assert.equal(selected.status, 'selected');
  assert.deepEqual(selected.capabilities, ['files.read']);

  const grantFailed = fixture(connection, { grantResult: null });
  await assert.rejects(
    () => resumeApproval(grantFailed.context, 's1', 'req1'),
    (e: any) => e.code === 'APPROVAL_CONTEXT_CHANGED',
  );

  const once = { ...connection, decisionScope: 'once' };
  const switched: any = await resumeApproval(fixture(once).context, 's1', 'req1');
  assert.equal(switched.status, 'selected');
  const pending = fixture(once, { switchResult: { status: 'approval_required' } });
  await assert.rejects(
    () => resumeApproval(pending.context, 's1', 'req1'),
    (e: any) => e.code === 'APPROVAL_PENDING',
  );

  const missing = fixture(once, { workspaceMissing: true });
  assert.deepEqual(await resumeApproval(missing.context, 's1', 'req1'), {
    ok: false,
    reason: 'workspace no longer exists',
  });

  const explicit = ticket(
    'workspace_select',
    { workspaceId: 'w1', profileId: 'developer', drainTimeoutMs: -3 },
    {
      operation: {
        family: 'workspace:select',
        capability: 'files.read',
        risk: 'MEDIUM',
        argsHash: 'x',
      },
      decisionScope: 'once',
    },
  );
  const explicitFx = fixture(explicit);
  await resumeApproval(explicitFx.context, 's1', 'req1');
});

test('frozen command and git operations replay exact values and surface worker errors', async () => {
  const command = ticket('command_run', {
    command: { executable: 'npm', args: ['test'], env: {} },
    executionMode: 'host',
    networkPolicy: { mode: 'allowlist', destinations: [], enforcement: 'backend' },
  });
  const commandFx = fixture(command);
  assert.deepEqual(await resumeApproval(commandFx.context, 's1', 'req1'), { command: true });
  assert.equal(commandFx.calls[0][3], 'host');

  const commit = ticket('git_commit', { message: 123, args: ['--no-verify'] });
  const commitFx = fixture(commit);
  assert.deepEqual(await resumeApproval(commitFx.context, 's1', 'req1'), { kind: 'git.commit' });
  const commitOp = commitFx.calls.find((row) => row[0] === 'worker')[1].operation;
  assert.equal(commitOp.message, '123');
  assert.deepEqual(commitOp.args, ['--no-verify']);

  const push = ticket('git_push', { remote: 'origin', branch: 'main' });
  const pushFx = fixture(push);
  assert.deepEqual(await resumeApproval(pushFx.context, 's1', 'req1'), { kind: 'git.push' });
  assert.deepEqual(pushFx.calls.find((row) => row[0] === 'worker')[1].operation.args, []);

  const failed = fixture(commit, { workerFailure: true });
  await assert.rejects(
    () => resumeApproval(failed.context, 's1', 'req1'),
    (e: any) => e.code === 'INVALID_REQUEST' && e.details?.kind === 'git.commit',
  );
});

test('frozen file rollback process skill and instruction mutations replay authorization context', async () => {
  const deletion = fixture(ticket('file_delete', { path: 42, recursive: 1 }));
  assert.deepEqual(await resumeApproval(deletion.context, 's1', 'req1'), { deleted: true });
  const deleteCall = deletion.calls.find((row) => row[0] === 'delete');
  assert.deepEqual(deleteCall[2], { path: '42', recursive: true });
  assert.equal(deleteCall[3].capability, 'files.delete');

  const rollback = fixture(ticket('change_rollback', { changeSetId: 7 }));
  assert.deepEqual(await resumeApproval(rollback.context, 's1', 'req1'), { rollback: true });
  assert.deepEqual(rollback.calls[0][2], { force: false, skipPaths: [] });

  const process = fixture(ticket('process_start', { executable: 'node' }));
  assert.deepEqual(await resumeApproval(process.context, 's1', 'req1'), { process: true });

  const skill = fixture(
    ticket('skill_write', { source: 'workspace', name: 4, file: 'x.md', content: 5 }),
  );
  assert.deepEqual(await resumeApproval(skill.context, 's1', 'req1'), { skill: true });
  const skillCall = skill.calls[0];
  assert.equal(skillCall[1], 'workspace');
  assert.equal(skillCall[2], '4');
  assert.equal(skillCall[4], 'x.md');
  assert.equal(skillCall[5], '5');

  const skillDefaults = fixture(ticket('skill_write', { source: 'other' }));
  await resumeApproval(skillDefaults.context, 's1', 'req1');
  assert.equal(skillDefaults.calls[0][1], 'user');
  assert.equal(skillDefaults.calls[0][4], undefined);
  assert.equal(skillDefaults.calls[0][5], '');

  const instructions = fixture(ticket('instructions_write', { source: 'workspace', content: 9 }));
  assert.deepEqual(await resumeApproval(instructions.context, 's1', 'req1'), {
    instructions: true,
  });
  const instructionDefaults = fixture(ticket('instructions_write', {}));
  await resumeApproval(instructionDefaults.context, 's1', 'req1');
  assert.equal(instructionDefaults.calls[0][1], 'user');
  assert.equal(instructionDefaults.calls[0][3], '');
});

test('capability replay validates frozen original and one-time scope cleanup', async () => {
  const cap = ticket(
    'capability_request',
    {},
    {
      operation: { family: 'npm:test', capability: 'commands.run', risk: 'HIGH', argsHash: 'x' },
      payload: {
        tool: 'capability_request',
        permissionMatcher: 'npm:test',
        original: { tool: 'command_run', args: undefined },
      },
    },
  );
  const fx = fixture(cap);
  assert.deepEqual(await resumeApproval(fx.context, 's1', 'req1'), { replayed: 'command_run' });
  assert.equal(fx.context.oneTimeCapabilities.size, 0);
  assert.deepEqual(fx.calls[0][3], {});

  const remembered = { ...cap, decisionScope: 'session' };
  const rememberedFx = fixture(remembered);
  await resumeApproval(rememberedFx.context, 's1', 'req1');
  assert.equal(rememberedFx.context.oneTimeCapabilities.size, 0);

  const missingOriginal = ticket(
    'capability_request',
    {},
    {
      operation: { family: 'files:write', capability: 'files.write', risk: 'HIGH', argsHash: 'x' },
      payload: { tool: 'capability_request', permissionMatcher: '*' },
    },
  );
  await assert.rejects(
    () => resumeApproval(fixture(missingOriginal).context, 's1', 'req1'),
    (e: any) => e.code === 'INVALID_REQUEST',
  );
});

test('frozen payload validation rejects missing and unsupported operations', async () => {
  const missing = ticket('ignored');
  missing.payload = null;
  await assert.rejects(
    () => resumeApproval(fixture(missing).context, 's1', 'req1'),
    (e: any) => e.code === 'INVALID_REQUEST',
  );
  const unsupported = ticket('unknown_tool');
  await assert.rejects(
    () => resumeApproval(fixture(unsupported).context, 's1', 'req1'),
    (e: any) => e.code === 'INVALID_REQUEST',
  );
});
