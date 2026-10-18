import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectorNotesService } from '../../../apps/core/src/usage/connector-notes.js';
import { AevraDatabase } from '../../store/src/database.js';
import { ConnectorNotesRepository } from '../../store/src/connector-notes.js';
import { MCP_IMAGE_CONTENT } from '../src/mcp-image-content.js';
import { handleJsonRpc } from '../src/register.js';
import { advertisedToolDefinitions } from '../src/registry-advertised.js';
import { toolDefinitions } from '../src/registry.js';
import { McpToolService } from '../src/service.js';
import { toolGroupOf } from '../src/tool-groups.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const ACTOR = 'connector:alpha';

function fixture() {
  const db = AevraDatabase.open(':memory:');
  const notes = new ConnectorNotesService(new ConnectorNotesRepository(db.raw()));
  const auditEvents: any[] = [];
  const sessions: any = {
    get: (id: string) => (id === 's1' ? { id: 's1', actor: ACTOR, subject: 'sub' } : undefined),
    touch: () => {},
  };
  const service = new McpToolService(sessions, {} as any, {} as any, {} as any, undefined, {
    connectorNotes: notes,
    audit: { append: (event: any) => auditEvents.push(event) } as any,
  });
  const call = async (name: string, args: unknown = {}) => {
    const response: any = await handleJsonRpc(service, 's1', {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    return response.result;
  };
  return { db, notes, service, call, auditEvents };
}

const errorCode = (result: any) => JSON.parse(result.content[0].text).error.code;

test('notes_list shows only visible notes for the caller with a 200-char preview', async () => {
  const { db, notes, call } = fixture();
  const shown = notes.create(ACTOR, {
    title: 'Todo',
    text: 'y'.repeat(250),
    aiCanDelete: true,
    readOnConnect: true,
    addImages: [{ dataBase64: PNG.toString('base64') }],
  });
  notes.create(ACTOR, { text: 'hidden words', visibleToAi: false });
  notes.create('connector:other', { text: 'not yours' });
  const result = await call('notes_list');
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, {
    notes: [
      {
        id: shown.id,
        title: 'Todo',
        preview: 'y'.repeat(200),
        imageCount: 1,
        aiCanDelete: true,
        readOnConnect: true,
        updatedAt: shown.updatedAt,
      },
    ],
  });
  assert.equal(result.content[0].text.includes('hidden words'), false);
  db.close();
});

test('notes_read returns text and image blocks; images never appear in text or structuredContent', async () => {
  const { db, notes, call } = fixture();
  const note = notes.create(ACTOR, {
    text: 'look at this',
    addImages: [{ name: 'shot', dataBase64: PNG.toString('base64') }],
  });
  const result = await call('notes_read', { id: note.id });
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 2);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(result.content[1], {
    type: 'image',
    data: PNG.toString('base64'),
    mimeType: 'image/png',
  });
  assert.equal(result.content[0].text.includes(PNG.toString('base64')), false);
  assert.deepEqual(result.structuredContent, {
    id: note.id,
    title: 'note-1',
    text: 'look at this',
    images: [{ id: note.images[0]!.id, name: 'shot', mimeType: 'image/png' }],
    aiCanDelete: false,
    readOnConnect: false,
    updatedAt: note.updatedAt,
  });
  assert.equal(Object.getOwnPropertySymbols(result.structuredContent).length, 0);
  assert.equal(JSON.stringify(result).split(PNG.toString('base64')).length, 2);
  db.close();
});

test('hidden and missing notes are indistinguishable NOTE_NOT_FOUND for read and delete', async () => {
  const { db, notes, call } = fixture();
  const hidden = notes.create(ACTOR, { text: 'h', visibleToAi: false, aiCanDelete: true });
  for (const id of [hidden.id, 'missing']) {
    const read = await call('notes_read', { id });
    assert.equal(read.isError, true);
    assert.equal(errorCode(read), 'NOTE_NOT_FOUND');
    const del = await call('notes_delete', { id });
    assert.equal(errorCode(del), 'NOTE_NOT_FOUND');
  }
  assert.equal(notes.notes(ACTOR).notes.length, 1);
  db.close();
});

test('notes_delete refuses a note the user has not allowed and deletes an allowed one', async () => {
  const { db, notes, call, auditEvents } = fixture();
  const locked = notes.create(ACTOR, { text: 'locked' });
  const done = notes.create(ACTOR, { text: 'done', aiCanDelete: true });
  const refused = await call('notes_delete', { id: locked.id });
  assert.equal(errorCode(refused), 'NOTE_NOT_DELETABLE');
  assert.match(JSON.parse(refused.content[0].text).error.message, /not allowed/i);
  const deleted = await call('notes_delete', { id: done.id });
  assert.deepEqual(deleted.structuredContent, { deleted: true, id: done.id });
  assert.deepEqual(
    notes.notes(ACTOR).notes.map((note) => note.id),
    [locked.id],
  );
  const event = auditEvents.find((entry) => entry.operation === 'connector.note.delete');
  assert.equal(event.actor, ACTOR);
  assert.equal(event.target, ACTOR);
  assert.equal(JSON.stringify(auditEvents).includes('done'), false);
  db.close();
});

test('notes tools need an id where required and a wired notes store', async () => {
  const { db, call } = fixture();
  assert.equal(errorCode(await call('notes_read', {})), 'INVALID_REQUEST');
  db.close();
  const bare = new McpToolService(
    { get: () => ({ id: 's1', actor: ACTOR }), touch: () => {} } as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const response: any = await handleJsonRpc(bare, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'notes_list', arguments: {} },
  });
  assert.equal(errorCode(response.result), 'CAPABILITY_REQUIRED');
});

test('a tool result without image content keeps a single text block', async () => {
  const service: any = { call: async () => ({ ok: true }) };
  const response: any = await handleJsonRpc(service, 's1', {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'file_list', arguments: {} },
  });
  assert.equal(response.result.content.length, 1);
  const withImages: any = {
    call: async () => ({
      value: 1,
      [MCP_IMAGE_CONTENT]: [{ type: 'image', data: 'AA==', mimeType: 'image/gif' }],
    }),
  };
  const textOnly: any = await handleJsonRpc(
    withImages,
    's1',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x_tool', arguments: {} } },
    undefined,
    { profile: { resultFormat: 'text' } },
  );
  assert.equal(textOnly.result.content[1].type, 'image');
  assert.deepEqual(JSON.parse(textOnly.result.content[0].text), { value: 1 });
});

test('notes tools are core-group, always listed, with honest annotations and guidance', () => {
  for (const name of ['notes_list', 'notes_read', 'notes_delete']) {
    assert.equal(toolGroupOf(name), 'core');
    assert.ok(
      advertisedToolDefinitions([]).some((tool) => tool.name === name),
      name,
    );
  }
  const defs = new Map(toolDefinitions().map((tool) => [tool.name as string, tool]));
  assert.equal(defs.get('notes_list')!.annotations.readOnlyHint, true);
  assert.equal(defs.get('notes_read')!.annotations.readOnlyHint, true);
  assert.equal(defs.get('notes_delete')!.annotations.destructiveHint, true);
  assert.equal(defs.get('notes_delete')!.annotations.readOnlyHint, false);
  for (const name of ['notes_list', 'notes_read', 'notes_delete']) {
    assert.equal(defs.get(name)!.annotations.openWorldHint, false);
  }
  assert.deepEqual((defs.get('notes_read')!.inputSchema as any).required, ['id']);
  assert.match(defs.get('notes_list')!.description, /only when the user mentions notes/i);
  assert.match(defs.get('notes_list')!.description, /readOnConnect/);
  assert.match(defs.get('notes_delete')!.description, /allowed/i);
});
