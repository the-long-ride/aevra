import assert from 'node:assert/strict';
import test from 'node:test';
import { AevraDatabase } from '../src/database.js';
import { ConnectorNotesRepository } from '../src/connector-notes.js';
import { sniffImageType } from '../src/connector-note-rules.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const GIF = Buffer.from('GIF89a-plain', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
const b64 = (bytes: Buffer) => bytes.toString('base64');

function open() {
  const db = AevraDatabase.open(':memory:');
  let tick = 0;
  const repo = new ConnectorNotesRepository(db.raw(), {
    now: () => new Date(Date.UTC(2026, 9, 1, 0, 0, tick++)),
  });
  return { db, repo };
}

function rejects(work: () => unknown, pattern: RegExp) {
  assert.throws(work, (error: any) => {
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_CONNECTOR_NOTE');
    assert.match(error.message, pattern);
    return true;
  });
}

test('migration 27 creates the connector note tables', () => {
  const { db } = open();
  const applied = db
    .raw()
    .prepare('SELECT name FROM schema_migrations WHERE version=27')
    .get() as any;
  assert.equal(applied.name, '027_connector_notes');
  const tables = db
    .raw()
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'connector_note%' AND type='table'")
    .all()
    .map((row: any) => row.name)
    .sort();
  assert.deepEqual(tables, ['connector_note_images', 'connector_notes']);
  db.close();
});

test('a new note gets the defaults and an automatic title', () => {
  const { db, repo } = open();
  const note = repo.create('connector:alpha', { text: 'move the logs' });
  assert.equal(note.actor, 'connector:alpha');
  assert.equal(note.title, 'note-1');
  assert.equal(note.text, 'move the logs');
  assert.equal(note.visibleToAi, true);
  assert.equal(note.aiCanDelete, false);
  assert.deepEqual(note.images, []);
  assert.ok(note.createdAt && note.updatedAt);
  assert.deepEqual(repo.get('connector:alpha', note.id), note);
  db.close();
});

test('automatic titles continue after the highest note-N, including gaps', () => {
  const { db, repo } = open();
  repo.create('connector:alpha', { title: 'note-1', text: 'a' });
  repo.create('connector:alpha', { title: 'note-5', text: 'b' });
  repo.create('connector:alpha', { title: 'note-x', text: 'c' });
  assert.equal(repo.create('connector:alpha', { title: '   ', text: 'd' }).title, 'note-6');
  assert.equal(repo.create('connector:beta', { text: 'e' }).title, 'note-1');
  db.close();
});

test('titles are trimmed and capped', () => {
  const { db, repo } = open();
  assert.equal(repo.create('connector:alpha', { title: '  Todo  ', text: 'a' }).title, 'Todo');
  rejects(() => repo.create('connector:alpha', { title: 'x'.repeat(81), text: 'a' }), /title/i);
  db.close();
});

test('text is capped and a note needs text or an image', () => {
  const { db, repo } = open();
  rejects(() => repo.create('connector:alpha', { text: 'x'.repeat(20001) }), /text/i);
  rejects(() => repo.create('connector:alpha', { text: '   ' }), /text or at least one image/i);
  rejects(() => repo.create('connector:alpha', {}), /text or at least one image/i);
  const imageOnly = repo.create('connector:alpha', { addImages: [{ dataBase64: b64(PNG) }] });
  assert.equal(imageOnly.images.length, 1);
  db.close();
});

test('unknown fields and wrong types are rejected', () => {
  const { db, repo } = open();
  rejects(() => repo.create('connector:alpha', { text: 'a', extra: 1 }), /unknown/i);
  rejects(() => repo.create('connector:alpha', { text: 5 }), /text/i);
  rejects(() => repo.create('connector:alpha', { text: 'a', visibleToAi: 'yes' }), /visibleToAi/);
  rejects(() => repo.create('connector:alpha', 'nope'), /object/i);
  db.close();
});

test('image types are decided by magic bytes; SVG and declared-only types are rejected', () => {
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(GIF), 'image/gif');
  assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(SVG), null);
  assert.equal(sniffImageType(Buffer.from('plain words')), null);
  const { db, repo } = open();
  const note = repo.create('connector:alpha', {
    text: 'pics',
    addImages: [
      { dataBase64: b64(PNG) },
      { name: '  photo  ', dataBase64: b64(JPEG) },
      { dataBase64: `data:image/png;base64,${b64(GIF)}` },
      { dataBase64: b64(WEBP) },
    ],
  });
  assert.deepEqual(
    note.images.map((image) => [image.name, image.mimeType]),
    [
      ['image-1', 'image/png'],
      ['photo', 'image/jpeg'],
      ['image-3', 'image/gif'],
      ['image-4', 'image/webp'],
    ],
  );
  assert.equal(note.images[0]!.sizeBytes, PNG.length);
  rejects(
    () => repo.create('connector:alpha', { addImages: [{ dataBase64: b64(SVG) }] }),
    /png, jpeg, gif or webp/i,
  );
  rejects(() => repo.create('connector:alpha', { addImages: [{ dataBase64: '***' }] }), /base64/i);
  db.close();
});

test('image limits: four per note, 2 MiB each, name length', () => {
  const { db, repo } = open();
  const five = Array.from({ length: 5 }, () => ({ dataBase64: b64(PNG) }));
  rejects(() => repo.create('connector:alpha', { addImages: five }), /4 images/);
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  rejects(() => repo.create('connector:alpha', { addImages: [{ dataBase64: b64(big) }] }), /2 MiB/);
  rejects(
    () =>
      repo.create('connector:alpha', {
        addImages: [{ name: 'n'.repeat(121), dataBase64: b64(PNG) }],
      }),
    /name/i,
  );
  db.close();
});

test('image bytes come back with the sniffed type, scoped to the actor', () => {
  const { db, repo } = open();
  const note = repo.create('connector:alpha', { addImages: [{ dataBase64: b64(JPEG) }] });
  const image = repo.image('connector:alpha', note.id, note.images[0]!.id);
  assert.equal(image?.mimeType, 'image/jpeg');
  assert.deepEqual(Buffer.from(image!.bytes), JPEG);
  assert.equal(repo.image('connector:beta', note.id, note.images[0]!.id), undefined);
  assert.equal(repo.image('connector:alpha', note.id, 'missing'), undefined);
  db.close();
});

test('update edits fields, keeps or reorders images and appends new ones', () => {
  const { db, repo } = open();
  const note = repo.create('connector:alpha', {
    text: 'first',
    addImages: [{ dataBase64: b64(PNG) }, { dataBase64: b64(JPEG) }],
  });
  const [png, jpeg] = note.images;
  const flipped = repo.update('connector:alpha', note.id, {
    aiCanDelete: true,
    visibleToAi: false,
  });
  assert.equal(flipped.aiCanDelete, true);
  assert.equal(flipped.visibleToAi, false);
  assert.equal(flipped.text, 'first');
  assert.deepEqual(flipped.images, note.images);
  assert.notEqual(flipped.updatedAt, note.updatedAt);
  assert.equal(flipped.createdAt, note.createdAt);
  const edited = repo.update('connector:alpha', note.id, {
    title: 'Renamed',
    text: 'second',
    keepImageIds: [jpeg!.id],
    addImages: [{ dataBase64: b64(GIF) }],
  });
  assert.equal(edited.title, 'Renamed');
  assert.equal(edited.text, 'second');
  assert.deepEqual(
    edited.images.map((image) => image.mimeType),
    ['image/jpeg', 'image/gif'],
  );
  assert.equal(edited.images[1]!.name, 'image-2');
  assert.equal(repo.image('connector:alpha', note.id, png!.id), undefined);
  rejects(() => repo.update('connector:alpha', note.id, { keepImageIds: ['other'] }), /image/i);
  rejects(
    () => repo.update('connector:alpha', note.id, { text: '', keepImageIds: [] }),
    /text or at least one image/i,
  );
  rejects(
    () =>
      repo.update('connector:alpha', note.id, {
        addImages: Array.from({ length: 3 }, () => ({ dataBase64: b64(PNG) })),
      }),
    /4 images/,
  );
  db.close();
});

test('update and delete of an unknown or foreign note are 404', () => {
  const { db, repo } = open();
  const note = repo.create('connector:alpha', { text: 'mine' });
  for (const work of [
    () => repo.update('connector:beta', note.id, { text: 'x' }),
    () => repo.update('connector:alpha', 'missing', { text: 'x' }),
  ]) {
    assert.throws(work, (error: any) => error.status === 404 && error.code === 'NOTE_NOT_FOUND');
  }
  assert.equal(repo.delete('connector:beta', note.id), false);
  assert.equal(repo.get('connector:beta', note.id), undefined);
  assert.equal(repo.list('connector:beta').length, 0);
  db.close();
});

test('delete is permanent and cascades to images', () => {
  const { db, repo } = open();
  const note = repo.create('connector:alpha', { addImages: [{ dataBase64: b64(PNG) }] });
  assert.equal(repo.delete('connector:alpha', note.id), true);
  assert.equal(repo.get('connector:alpha', note.id), undefined);
  const left = db.raw().prepare('SELECT COUNT(*) n FROM connector_note_images').get() as any;
  assert.equal(Number(left.n), 0);
  assert.equal(repo.delete('connector:alpha', note.id), false);
  db.close();
});

test('list is newest first with image metadata only, and counts per actor', () => {
  const { db, repo } = open();
  const first = repo.create('connector:alpha', { text: 'one' });
  const second = repo.create('connector:alpha', {
    text: 'two',
    addImages: [{ dataBase64: b64(PNG) }],
  });
  repo.create('connector:beta', { text: 'other' });
  const listed = repo.list('connector:alpha');
  assert.deepEqual(
    listed.map((note) => note.id),
    [second.id, first.id],
  );
  assert.deepEqual(Object.keys(listed[0]!.images[0]!).sort(), [
    'id',
    'mimeType',
    'name',
    'sizeBytes',
  ]);
  assert.equal(repo.countByActor('connector:alpha'), 2);
  assert.equal(repo.countByActor('connector:none'), 0);
  db.close();
});

test('an actor may keep at most 200 notes', () => {
  const { db, repo } = open();
  const insert = db
    .raw()
    .prepare(
      "INSERT INTO connector_notes(id,actor,title,body,created_at,updated_at) VALUES(?,'connector:alpha',?,'x','t','t')",
    );
  for (let i = 0; i < 200; i++) insert.run(`n${i}`, `t${i}`);
  rejects(() => repo.create('connector:alpha', { text: 'one more' }), /200 notes/);
  assert.equal(repo.create('connector:beta', { text: 'fine' }).title, 'note-1');
  db.close();
});

test('a failed update leaves the note unchanged', () => {
  const { db, repo } = open();
  const note = repo.create('connector:alpha', {
    text: 'keep',
    addImages: [{ dataBase64: b64(PNG) }],
  });
  rejects(
    () =>
      repo.update('connector:alpha', note.id, {
        text: 'changed',
        addImages: [{ dataBase64: b64(SVG) }],
      }),
    /png/i,
  );
  assert.deepEqual(repo.get('connector:alpha', note.id), note);
  db.close();
});
