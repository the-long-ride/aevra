import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../../../packages/store/src/database.js';
import { ConnectorNotesRepository } from '../../../packages/store/src/connector-notes.js';
import { SettingsRepository } from '../../../packages/store/src/settings.js';
import { ConnectorNotesService } from '../src/usage/connector-notes.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const ACTOR = 'connector:alpha';

function open() {
  const db = AevraDatabase.open(':memory:');
  const settings = new SettingsRepository(db.raw());
  const service = new ConnectorNotesService(new ConnectorNotesRepository(db.raw()));
  return { db, settings, service };
}

const notice = (count: number) =>
  `This connector has ${count} note(s) the user wants read on connect. Call notes_list, then notes_read for each note with readOnConnect true, before starting other work.`;

test('notes() returns the actor and the notes, with no connector-level switch', () => {
  const { db, service } = open();
  const note = service.create(ACTOR, { text: 'hello' });
  assert.equal(note.readOnConnect, false);
  assert.deepEqual(service.notes(ACTOR), { actor: ACTOR, notes: [note] });
  assert.equal('setReadOnConnect' in service, false);
  db.close();
});

test('the old per-connector settings key is ignored', () => {
  const { db, service, settings } = open();
  settings.set('mcp.connectorNoteSettings', { [ACTOR]: { readOnConnect: true } });
  service.create(ACTOR, { text: 'visible but not flagged' });
  assert.equal(service.connectNotice(ACTOR), null);
  db.close();
});

test('invalid actors are rejected', () => {
  const { db, service } = open();
  for (const actor of ['', '__proto__', 'a\u0001b', 'x'.repeat(201)]) {
    assert.throws(
      () => service.notes(actor),
      (error: any) => error.status === 400 && error.code === 'INVALID_CONNECTOR_NOTE',
    );
  }
  db.close();
});

test('delete of an unknown note is a 404', () => {
  const { db, service } = open();
  assert.throws(
    () => service.delete(ACTOR, 'missing'),
    (error: any) => error.status === 404 && error.code === 'NOTE_NOT_FOUND',
  );
  db.close();
});

test('AI views only see notes visible to the AI', () => {
  const { db, service } = open();
  const shown = service.create(ACTOR, {
    text: 'shown',
    readOnConnect: true,
    addImages: [{ name: 'pic', dataBase64: PNG.toString('base64') }],
  });
  const hidden = service.create(ACTOR, { text: 'hidden', visibleToAi: false });
  assert.deepEqual(
    service.listVisible(ACTOR).map((note) => note.id),
    [shown.id],
  );
  assert.equal(service.listVisible(ACTOR)[0]!.readOnConnect, true);
  assert.equal(service.readVisible(ACTOR, hidden.id), undefined);
  assert.equal(service.readVisible(ACTOR, 'missing'), undefined);
  assert.equal(service.readVisible('connector:other', shown.id), undefined);
  const read = service.readVisible(ACTOR, shown.id)!;
  assert.equal(read.text, 'shown');
  assert.equal(read.readOnConnect, true);
  assert.equal(read.images[0]!.name, 'pic');
  assert.equal(read.images[0]!.mimeType, 'image/png');
  assert.deepEqual(Buffer.from(read.images[0]!.data), PNG);
  assert.deepEqual(service.listVisible('__proto__'), []);
  db.close();
});

test('deleteByAi needs a visible note the user allowed the AI to delete', () => {
  const { db, service } = open();
  const locked = service.create(ACTOR, { text: 'locked' });
  const hiddenDeletable = service.create(ACTOR, {
    text: 'hidden',
    visibleToAi: false,
    aiCanDelete: true,
  });
  const open_ = service.create(ACTOR, { text: 'done', aiCanDelete: true });
  assert.equal(service.deleteByAi(ACTOR, 'missing'), 'not_found');
  assert.equal(service.deleteByAi(ACTOR, hiddenDeletable.id), 'not_found');
  assert.equal(service.deleteByAi(ACTOR, locked.id), 'not_deletable');
  assert.equal(service.deleteByAi('connector:other', open_.id), 'not_found');
  assert.equal(service.deleteByAi(ACTOR, open_.id), 'deleted');
  assert.equal(
    service.notes(ACTOR).notes.some((note) => note.id === open_.id),
    false,
  );
  assert.equal(service.notes(ACTOR).notes.length, 2);
  db.close();
});

test('connectNotice counts only visible notes flagged read on connect', () => {
  const { db, service } = open();
  assert.equal(service.connectNotice(ACTOR), null, 'no notes');
  service.create(ACTOR, { text: 'visible but unflagged' });
  assert.equal(service.connectNotice(ACTOR), null, 'visible but unflagged');
  service.create(ACTOR, { text: 'flagged but hidden', visibleToAi: false, readOnConnect: true });
  assert.equal(service.connectNotice(ACTOR), null, 'flagged but hidden');
  const first = service.create(ACTOR, { text: 'one', readOnConnect: true });
  service.create(ACTOR, { text: 'two', readOnConnect: true });
  assert.equal(service.connectNotice(ACTOR), notice(2));
  service.update(ACTOR, first.id, { visibleToAi: false });
  assert.equal(service.connectNotice(ACTOR), notice(1));
  assert.equal(service.connectNotice('connector:other'), null);
  assert.equal(service.connectNotice(''), null);
  db.close();
});
