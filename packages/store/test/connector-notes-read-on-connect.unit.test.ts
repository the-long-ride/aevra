import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ConnectorNotesRepository } from '../src/connector-notes.js';
import { applyMigrations, migrations } from '../src/migrations.js';

const ACTOR = 'connector:alpha';

function applyThrough(db: DatabaseSync, last: number) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)',
  );
  for (const m of migrations.filter((entry) => entry.version <= last)) {
    if (m.sql) db.exec(m.sql);
    m.apply?.(db);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(
      m.version,
      m.name,
      '2026-10-01T00:00:00.000Z',
    );
  }
}

test('migration 28 adds read_on_connect with default 0 to existing v27 notes', () => {
  const db = new DatabaseSync(':memory:');
  applyThrough(db, 27);
  db.prepare(
    'INSERT INTO connector_notes(id,actor,title,body,visible_to_ai,ai_can_delete,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
  ).run('old', ACTOR, 'note-1', 'kept words', 1, 0, 'x', 'x');
  applyMigrations(db);
  const applied = db.prepare('SELECT name FROM schema_migrations WHERE version=28').get() as any;
  assert.equal(applied.name, '028_connector_note_read_on_connect');
  const row = db
    .prepare('SELECT read_on_connect, body FROM connector_notes WHERE id=?')
    .get('old') as any;
  assert.equal(row.read_on_connect, 0);
  assert.equal(row.body, 'kept words');
  const note = new ConnectorNotesRepository(db).get(ACTOR, 'old')!;
  assert.equal(note.readOnConnect, false);
  db.close();
});

test('readOnConnect defaults to false, round-trips on create and update, and is validated', () => {
  const db = AevraDatabase.open(':memory:');
  const repo = new ConnectorNotesRepository(db.raw());
  const plain = repo.create(ACTOR, { text: 'plain' });
  assert.equal(plain.readOnConnect, false);
  const flagged = repo.create(ACTOR, { text: 'flagged', readOnConnect: true });
  assert.equal(flagged.readOnConnect, true);
  assert.equal(repo.update(ACTOR, plain.id, { readOnConnect: true }).readOnConnect, true);
  assert.equal(repo.update(ACTOR, plain.id, { text: 'edited' }).readOnConnect, true);
  assert.equal(repo.update(ACTOR, flagged.id, { readOnConnect: false }).readOnConnect, false);
  assert.deepEqual(
    repo.list(ACTOR).map((note) => note.readOnConnect),
    [false, true],
  );
  for (const value of ['yes', 1, null]) {
    assert.throws(
      () => repo.create(ACTOR, { text: 'x', readOnConnect: value }),
      (error: any) =>
        error.status === 400 &&
        error.code === 'INVALID_CONNECTOR_NOTE' &&
        /readOnConnect must be true or false/.test(error.message),
    );
  }
  db.close();
});
