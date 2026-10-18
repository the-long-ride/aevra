import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminApiContext, AdminRouteHandler } from './types.js';

const PREFIX = '/api/connector-notes/';
/** Images travel base64 in JSON, so note writes get a larger limit than other admin routes. */
const NOTE_BODY_LIMIT_BYTES = 12 * 1024 * 1024;

type Response = Parameters<AdminRouteHandler>[1];

function fail(res: Response, status: number, code: string, message: string): true {
  sendAdminResponse(res, status, { error: { code, message } });
  return true;
}

function audit(context: AdminApiContext, operation: string, actor: string) {
  // Never the note text or image data: only who and which connector.
  context.audit?.append?.({
    actor: 'admin',
    operation,
    target: actor,
    result: 'ok',
    redactionCount: 0,
    class: 'normal',
  });
}

function decodeSegments(path: string): string[] | null {
  try {
    return path.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

export const handleConnectorNoteRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (!url.pathname.startsWith(PREFIX)) return false;
  const notes = context.connectorNotes;
  if (!notes) return fail(res, 503, 'NOTES_UNAVAILABLE', 'Connector notes are not available.');
  const segments = decodeSegments(url.pathname.slice(PREFIX.length));
  if (!segments) return fail(res, 400, 'INVALID_CONNECTOR_NOTE', 'Invalid connector actor.');
  const [actor = '', section, noteId, sub, imageId, ...rest] = segments;
  const method = req.method ?? 'GET';
  // Errors thrown below carry status and code; handleAdminApi maps them.
  if (section === undefined) {
    if (method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET.');
    sendAdminResponse(res, 200, notes.notes(actor));
    return true;
  }
  if (section !== 'notes' || rest.length) return fail(res, 404, 'NOT_FOUND', 'Unknown route.');
  if (noteId === undefined) {
    if (method !== 'POST') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use POST.');
    const created = notes.create(actor, await readAdminBody(req, NOTE_BODY_LIMIT_BYTES));
    audit(context, 'connector.note.create', actor);
    sendAdminResponse(res, 201, created);
    return true;
  }
  if (sub === undefined) {
    if (method === 'PATCH') {
      const body = await readAdminBody(req, NOTE_BODY_LIMIT_BYTES);
      const updated = notes.update(actor, noteId, body);
      audit(context, 'connector.note.update', actor);
      sendAdminResponse(res, 200, updated);
      return true;
    }
    if (method === 'DELETE') {
      notes.delete(actor, noteId);
      audit(context, 'connector.note.delete', actor);
      sendAdminResponse(res, 200, { deleted: true });
      return true;
    }
    return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use PATCH or DELETE.');
  }
  if (sub !== 'images' || imageId === undefined) {
    return fail(res, 404, 'NOT_FOUND', 'Unknown route.');
  }
  if (method !== 'GET') return fail(res, 405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  const image = notes.image(actor, noteId, imageId);
  if (!image) return fail(res, 404, 'NOTE_NOT_FOUND', 'Image not found.');
  res.statusCode = 200;
  res.setHeader('content-type', image.mimeType);
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(image.bytes);
  return true;
};
