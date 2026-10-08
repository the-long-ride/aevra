import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { ConnectorProfileStore, parseConnectorProfile } from '../src/usage/connector-profiles.js';

const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (error: any) {
    return error;
  }
  assert.fail('expected a throw');
};

test('parse keeps a limited profile', () => {
  assert.deepEqual(parseConnectorProfile({ toolGroups: ['git', 'files'], resultFormat: 'text' }), {
    toolGroups: ['files', 'git'],
    resultFormat: 'text',
  });
});

test('parse omits defaults: all groups and the both format', () => {
  assert.deepEqual(
    parseConnectorProfile({
      toolGroups: [
        'files',
        'commands',
        'git',
        'changes',
        'skills',
        'browser',
        'desktop',
        'control',
        'upstream',
      ],
      resultFormat: 'both',
    }),
    {},
  );
});

test('an empty group list means core only and is kept', () => {
  assert.deepEqual(parseConnectorProfile({ toolGroups: [] }), { toolGroups: [] });
});

test('parse rejects unknown groups, core, formats, keys and shapes with a 400', () => {
  for (const bad of [
    { toolGroups: ['nope'] },
    { toolGroups: ['core'] },
    { toolGroups: 'files' },
    { resultFormat: 'xml' },
    { other: 1 },
    [],
    'x',
    null,
  ]) {
    const error = thrown(() => parseConnectorProfile(bad));
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_CONNECTOR_PROFILE');
  }
});

function open() {
  const db = AevraDatabase.open(':memory:');
  return { db, settings: new SettingsRepository(db.raw()) };
}

test('set persists, get reads back, empty profile removes the entry', () => {
  const { db, settings } = open();
  const profiles = new ConnectorProfileStore(settings);
  assert.equal(profiles.get('connector:alpha'), undefined);
  profiles.set('connector:alpha', { toolGroups: ['files'] });
  assert.deepEqual(profiles.get('connector:alpha'), { toolGroups: ['files'] });
  const reopened = new ConnectorProfileStore(settings);
  assert.deepEqual(reopened.get('connector:alpha'), { toolGroups: ['files'] });
  profiles.set('connector:alpha', {});
  assert.equal(profiles.get('connector:alpha'), undefined);
  assert.equal(profiles.all().size, 0);
  db.close();
});

test('actors are validated and prototype keys are inert', () => {
  const { db, settings } = open();
  const profiles = new ConnectorProfileStore(settings);
  assert.equal(thrown(() => profiles.set('', {})).code, 'INVALID_CONNECTOR_PROFILE');
  assert.equal(
    thrown(() => profiles.set('__proto__', { toolGroups: [] })).code,
    'INVALID_CONNECTOR_PROFILE',
  );
  assert.equal(profiles.get('constructor'), undefined);
  assert.equal(profiles.get('toString'), undefined);
  db.close();
});

test('corrupt stored JSON reads as no profiles', () => {
  const { db, settings } = open();
  db.raw()
    .prepare('INSERT INTO settings(key,value_json,revision) VALUES(?,?,1)')
    .run('mcp.connectorProfiles', '{not json');
  assert.equal(new ConnectorProfileStore(settings).all().size, 0);
  db.close();
});

test('one bad stored entry is skipped and the rest kept', () => {
  const { db, settings } = open();
  settings.set('mcp.connectorProfiles', {
    'connector:bad': { toolGroups: ['nope'] },
    'connector:good': { resultFormat: 'text' },
  });
  const profiles = new ConnectorProfileStore(settings);
  assert.equal(profiles.get('connector:bad'), undefined);
  assert.deepEqual(profiles.get('connector:good'), { resultFormat: 'text' });
  db.close();
});
