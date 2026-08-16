import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigExportService } from '../src/config/export-service.js';

function fakeDb(tables: Record<string, any[]>) {
  return {
    prepare(query: string) {
      const key = /FROM\s+(\w+)/i.exec(query)?.[1] ?? '';
      const rows = tables[key] ?? [];
      if (/^SELECT id,name/i.test(query)) {
        return {
          all: () => rows.map((r) => ({ ...r })),
        };
      }
      return { all: () => rows.map((r) => ({ ...r })) };
    },
  } as any;
}

const full = {
  workspaces: [{ id: 'w1', name: 'main', description: 'd', host_root: 'F:/ws/main' }],
  external_mounts: [
    {
      id: 'm1',
      workspace_id: 'w1',
      logical_path: '/lib',
      host_root: 'F:/data/lib',
      capabilities_json: JSON.stringify(['files.read']),
      sensitivity_policy_id: 'sp1',
    },
  ],
  permission_rules: [{ id: 'r1' }],
  capability_profiles: [{ id: 'coding', name: 'Coding', capabilities_json: '[]', builtin: 1 }],
  environment_profiles: [
    {
      id: 'e1',
      name: 'ci',
      vars_json: JSON.stringify({ CI: '1' }),
      secret_refs_json: JSON.stringify({ TOKEN: 'ref-1' }),
    },
  ],
};

test('export keeps host roots and secret references unless portable', () => {
  const service = new ConfigExportService(fakeDb(full));

  const exported = service.export(false);
  assert.equal(exported.version, 1);
  assert.equal(exported.portable, false);
  assert.deepEqual(exported.workspaces, [
    { id: 'w1', name: 'main', description: 'd', hostRoot: 'F:/ws/main' },
  ]);
  assert.deepEqual(exported.mounts, [
    {
      id: 'm1',
      workspaceId: 'w1',
      logicalPath: '/lib',
      hostRoot: 'F:/data/lib',
      capabilities: ['files.read'],
      sensitivityPolicyId: 'sp1',
    },
  ]);
  assert.deepEqual(exported.rules, [{ id: 'r1' }]);
  assert.deepEqual(exported.profiles, [
    { id: 'coding', name: 'Coding', capabilities_json: '[]', builtin: 1 },
  ]);
  assert.deepEqual(exported.environmentProfiles, [
    { id: 'e1', name: 'ci', vars: { CI: '1' }, secretRefs: { TOKEN: 'RECONNECT_REQUIRED' } },
  ]);
});

test('portable export drops host roots and secret references entirely', () => {
  const service = new ConfigExportService(fakeDb(full));
  const portable = service.export(true);

  assert.equal(portable.portable, true);
  assert.deepEqual(portable.workspaces, [{ id: 'w1', name: 'main', description: 'd' }]);
  assert.deepEqual(portable.mounts, [
    {
      id: 'm1',
      workspaceId: 'w1',
      logicalPath: '/lib',
      capabilities: ['files.read'],
    },
  ]);
  assert.deepEqual(portable.environmentProfiles, [
    { id: 'e1', name: 'ci', vars: { CI: '1' }, secretRefs: {} },
  ]);
});

test('previewImport counts adds changes remaps and secret reconnects', () => {
  const service = new ConfigExportService(fakeDb({ workspaces: [{ id: 'w1' }, { id: 'old' }] }));

  assert.deepEqual(
    service.previewImport({
      workspaces: [
        { id: 'w1', hostRoot: 'F:/ws/main' },
        { id: 'new', name: 'incoming' },
        { id: 'another' },
      ],
      environmentProfiles: [{ secretRefs: { A: 'a', B: 'b' } }, { secretRefs: {} }, {}],
    }),
    { add: 2, change: 1, pathRemap: 2, secretReconnect: 2 },
  );

  assert.deepEqual(service.previewImport(undefined), {
    add: 0,
    change: 0,
    pathRemap: 0,
    secretReconnect: 0,
  });
});
