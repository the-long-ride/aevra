import { AevraToolError } from './errors.js';
import { withImageContent } from './mcp-image-content.js';
import type { McpRuntimeContext } from './service-types.js';

export const NOTES_TOOL_NAMES = new Set(['notes_list', 'notes_read', 'notes_delete']);
const PREVIEW_CHARS = 200;

function notFound(): AevraToolError {
  return new AevraToolError('NOTE_NOT_FOUND', 'No note with that id is available to you.');
}

function noteId(args: any): string {
  const id = typeof args?.id === 'string' ? args.id.trim() : '';
  if (!id) throw new AevraToolError('INVALID_REQUEST', 'id is required.');
  return id;
}

/** Notes the user left for this connector. The user's switches are the permission. */
export async function handleNotesTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  const notes = context.deps.connectorNotes;
  if (!notes) throw new AevraToolError('CAPABILITY_REQUIRED', 'Connector notes are unavailable.');
  const actor = String(context.sessions.get(sessionId)?.actor ?? '');
  if (name === 'notes_list') {
    return {
      notes: notes.listVisible(actor).map((note) => ({
        id: note.id,
        title: note.title,
        preview: note.text.slice(0, PREVIEW_CHARS),
        imageCount: note.images.length,
        aiCanDelete: note.aiCanDelete,
        readOnConnect: note.readOnConnect,
        updatedAt: note.updatedAt,
      })),
    };
  }
  const id = noteId(args);
  if (name === 'notes_read') {
    const note = notes.readVisible(actor, id);
    if (!note) throw notFound();
    return withImageContent(
      {
        id: note.id,
        title: note.title,
        text: note.text,
        images: note.images.map((image) => ({
          id: image.id,
          name: image.name,
          mimeType: image.mimeType,
        })),
        aiCanDelete: note.aiCanDelete,
        readOnConnect: note.readOnConnect,
        updatedAt: note.updatedAt,
      },
      note.images.map((image) => ({
        type: 'image' as const,
        data: Buffer.from(image.data).toString('base64'),
        mimeType: image.mimeType,
      })),
    );
  }
  const outcome = notes.deleteByAi(actor, id);
  if (outcome === 'not_found') throw notFound();
  if (outcome === 'not_deletable') {
    throw new AevraToolError(
      'NOTE_NOT_DELETABLE',
      'The user has not allowed you to delete this note. Leave it in place.',
    );
  }
  context.deps.audit?.append({
    actor,
    sessionId,
    tool: name,
    operation: 'connector.note.delete',
    target: actor,
    risk: 'LOW',
    decision: 'allowed',
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
  return { deleted: true, id };
}
