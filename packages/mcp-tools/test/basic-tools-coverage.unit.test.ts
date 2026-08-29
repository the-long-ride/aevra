import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleBasicTool,
  promptGet,
  promptsList,
  resourceRead,
  resourcesList,
} from '../src/basic-tools.js';

function fixture(options: { leases?: any[]; workspaceId?: string; withSkills?: boolean } = {}) {
  const leases = options.leases ?? [
    {
      id: 'l1',
      workspaceId: 'w1',
      capabilities: ['skills.read', 'skills.write', 'instructions.read', 'instructions.write'],
      expiresAt: 'later',
    },
  ];
  const audits: any[] = [];
  const skillWrites: any[] = [];
  const skills =
    options.withSkills === false
      ? undefined
      : {
          list: () => [
            { name: 'Alpha Skill', description: 'first helper', source: 'user' },
            { name: 'Beta', description: '', source: 'workspace' },
            { name: 'Gamma', description: 'searchable beta phrase', source: 'user' },
          ],
          read: (source: string, name: string, root: string | null, file?: string) => ({
            source,
            name,
            root,
            file: file ?? 'SKILL.md',
            content: `${source}:${name}:${file ?? 'SKILL.md'}`,
          }),
          write: (...args: any[]) => {
            skillWrites.push(['write', ...args]);
            return { ok: true };
          },
          instructions: () => ({
            instructions: [
              { source: 'user', content: 'User rules' },
              { source: 'workspace', content: 'Workspace rules' },
            ],
            note: 'fallback note',
          }),
          writeInstructions: (...args: any[]) => {
            skillWrites.push(['instructions', ...args]);
            return { ok: true };
          },
        };
  const sessions: any = {
    get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
    activeLease: () => (leases.length === 1 ? leases[0] : null),
    leases: () => leases,
    leaseForWorkspace: (_s: string, id: string) =>
      leases.find((lease) => lease.workspaceId === id) ?? null,
    isYolo: () => true,
  };
  const remote = [
    { id: 'w1', name: 'One', description: 'one' },
    { id: 'w2', name: 'Two', description: 'two' },
    { id: 'w3', name: 'Three', description: 'three' },
  ];
  const context: any = {
    sessions,
    workspaces: {
      listRemote: () => remote,
      getLocal: (value: string) => {
        const found = remote.find((row) => row.id === value || row.name === value);
        return found ? { ...found, hostRoot: `/host/${found.id}` } : null;
      },
    },
    workspaceId: options.workspaceId,
    worker: { execute: async () => ({ ok: true, value: {} }) },
    reads: {},
    approvals: {
      status: (id: string) => ({ id, state: 'PENDING' }),
      cancel: (id: string) => ({ id, state: 'CANCELLED' }),
    },
    deps: {
      skills,
      audit: { append: (row: any) => audits.push(row) },
      permissions: {
        summary: ({ baselineCapabilities }: any) => ({
          effectiveCapabilities: [...baselineCapabilities, 'files.read'],
          commandMatchers: ['git:status'],
        }),
      },
    },
    oneTimeCapabilities: new Set<string>(),
    processStart: async () => ({}),
    callInner: async () => ({}),
  };
  return { context, audits, skillWrites, leases };
}

test('status covers zero one and multiple lease shapes plus missing remote workspace', async () => {
  const none = fixture({ leases: [] });
  const empty = await handleBasicTool(none.context, 's1', 'aevra_status', {});
  assert.equal(empty.workspace, null);
  assert.deepEqual(empty.workspaces, []);
  assert.deepEqual(empty.effectiveCapabilities, []);

  const one = fixture();
  const status: any = await handleBasicTool(one.context, 's1', 'aevra_status', {});
  assert.equal(status.workspace.id, 'w1');
  assert.ok(status.effectiveCapabilities.includes('files.read'));
  assert.equal(status.workspaces[0].commandMatchers[0], 'git:status');

  const oneNoPerm = fixture();
  oneNoPerm.context.deps.permissions = undefined;
  const statusNoPerm: any = await handleBasicTool(oneNoPerm.context, 's1', 'aevra_status', {});
  assert.equal(statusNoPerm.workspace.id, 'w1');
  assert.deepEqual(statusNoPerm.effectiveCapabilities, [
    'skills.read',
    'skills.write',
    'instructions.read',
    'instructions.write',
  ]);

  const multiple = fixture({
    leases: [
      { id: 'l1', workspaceId: 'w1', capabilities: ['files.read'], expiresAt: 'a' },
      { id: 'lX', workspaceId: 'unknown', capabilities: ['files.search'], expiresAt: 'b' },
    ],
  });
  multiple.context.deps.permissions = undefined;
  const multi: any = await handleBasicTool(multiple.context, 's1', 'aevra_status', {});
  assert.equal(multi.workspace, null);
  assert.equal(multi.workspaces[1].name, 'unknown');
  assert.deepEqual(multi.workspaces[1].effectiveCapabilities, ['files.search']);
});

test('skills list covers query pagination defaults numeric clamping and no-workspace reads', async () => {
  const fx = fixture({ leases: [] });
  const all: any = await handleBasicTool(fx.context, 's1', 'skills_list', {});
  assert.equal(all.total, 3);
  assert.equal(all.limit, 3);
  const filtered: any = await handleBasicTool(fx.context, 's1', 'skills_list', {
    query: 'BETA',
    offset: -4,
    limit: '1',
  });
  assert.equal(filtered.total, 2);
  assert.equal(filtered.offset, 0);
  assert.equal(filtered.limit, 1);
  assert.equal(filtered.skills.length, 1);
  const zero: any = await handleBasicTool(fx.context, 's1', 'skills_list', { limit: 'bad' });
  assert.equal(zero.limit, 0);
});

test('skill and instruction read/write cover sources files defaults auditing and missing service', async () => {
  const fx = fixture();
  const user: any = await handleBasicTool(fx.context, 's1', 'skill_read', { name: 'Alpha Skill' });
  assert.equal(user.source, 'user');
  assert.equal(user.file, 'SKILL.md');
  const workspace: any = await handleBasicTool(fx.context, 's1', 'skill_read', {
    source: 'workspace',
    name: 'Beta',
    file: 'guide.md',
  });
  assert.equal(workspace.source, 'workspace');
  assert.equal(workspace.file, 'guide.md');
  await handleBasicTool(fx.context, 's1', 'skill_write', {
    source: 'workspace',
    name: 'Beta',
    file: 'notes.md',
    content: 42,
  });
  await handleBasicTool(fx.context, 's1', 'skill_write', { name: 'Alpha Skill' });
  const instructions: any = await handleBasicTool(fx.context, 's1', 'instructions_read', {});
  assert.equal(instructions.instructions.length, 2);
  await handleBasicTool(fx.context, 's1', 'instructions_write', {
    source: 'workspace',
    content: 9,
  });
  await handleBasicTool(fx.context, 's1', 'instructions_write', { source: 'invalid', content: '' });
  assert.ok(fx.audits.some((row) => row.tool === 'skill_write'));
  assert.ok(fx.audits.some((row) => row.tool === 'instructions_write'));
  assert.ok(fx.skillWrites.length >= 4);

  const missing = fixture({ withSkills: false });
  const note: any = await handleBasicTool(missing.context, 's1', 'instructions_read', {});
  assert.equal(note.note, 'skills not configured');
  await assert.rejects(
    () => handleBasicTool(missing.context, 's1', 'skill_read', { name: 'x' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => handleBasicTool(missing.context, 's1', 'skill_write', { name: 'x' }),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
  await assert.rejects(
    () => handleBasicTool(missing.context, 's1', 'instructions_write', {}),
    (error: any) => error.code === 'CAPABILITY_REQUIRED',
  );
});

test('approval and workspace helpers cover null current single current and multi current', async () => {
  const fx = fixture();
  assert.equal(
    ((await handleBasicTool(fx.context, 's1', 'approval_status', { requestId: 7 })) as any).id,
    '7',
  );
  assert.equal(
    ((await handleBasicTool(fx.context, 's1', 'approval_cancel', { requestId: 8 })) as any).state,
    'CANCELLED',
  );
  const list: any = await handleBasicTool(fx.context, 's1', 'workspace_list', {});
  assert.equal(list.workspaces.find((row: any) => row.id === 'w1').granted, true);
  assert.equal(list.workspaces.find((row: any) => row.id === 'w2').granted, false);
  assert.equal(
    ((await handleBasicTool(fx.context, 's1', 'workspace_current', {})) as any).id,
    'w1',
  );

  const none = fixture({ leases: [] });
  assert.deepEqual(await handleBasicTool(none.context, 's1', 'workspace_current', {}), {
    status: 'none',
    workspace: null,
  });
  const multi = fixture({
    leases: [
      { id: 'l1', workspaceId: 'w1', capabilities: [], expiresAt: 'x' },
      { id: 'l2', workspaceId: 'w2', capabilities: [], expiresAt: 'x' },
    ],
  });
  const current: any = await handleBasicTool(multi.context, 's1', 'workspace_current', {});
  assert.equal(current.status, 'multiple');
  assert.deepEqual(
    current.workspaces.map((row: any) => row.id),
    ['w1', 'w2'],
  );

  fx.context.approvals = undefined;
  assert.deepEqual(await handleBasicTool(fx.context, 's1', 'approval_status', { requestId: 'x' }), {
    status: 'unavailable',
  });
  assert.deepEqual(await handleBasicTool(fx.context, 's1', 'approval_cancel', { requestId: 'x' }), {
    status: 'unavailable',
  });
});

test('resource and prompt surfaces cover descriptions URI validation missing services and text fallbacks', async () => {
  const fx = fixture();
  const resources = resourcesList(fx.context, 's1').resources;
  assert.equal(resources.length, 3);
  assert.equal(resources[1].description, 'Skill from workspace library');
  assert.match(resources[0].uri, /Alpha%20Skill/);
  const read = await resourceRead(fx.context, 's1', resources[0].uri);
  assert.match(read.contents[0].text, /Alpha Skill/);
  await assert.rejects(
    () => resourceRead(fx.context, 's1', 'bad://uri'),
    (e: any) => e.code === 'INVALID_REQUEST',
  );
  const missing = fixture({ withSkills: false });
  await assert.rejects(
    () => resourceRead(missing.context, 's1', 'aevra://skill/user/Test'),
    (e: any) => e.code === 'SKILL_NOT_FOUND',
  );
  assert.equal(resourcesList(missing.context, 's1').resources.length, 0);
  assert.equal(promptsList().prompts[0].name, 'aevra-instructions');
  const prompt = await promptGet(fx.context, 's1');
  assert.match(prompt.messages[0].content.text, /User rules/);
  await assert.rejects(
    () => promptGet(missing.context, 's1'),
    (e: any) => e.code === 'INVALID_REQUEST',
  );

  fx.context.deps.skills.instructions = () => ({ instructions: [], note: 'Use the note' });
  assert.equal((await promptGet(fx.context, 's1')).messages[0].content.text, 'Use the note');
  fx.context.deps.skills.instructions = () => ({ instructions: [], note: '' });
  assert.equal(
    (await promptGet(fx.context, 's1')).messages[0].content.text,
    'No instruction files found.',
  );
});
