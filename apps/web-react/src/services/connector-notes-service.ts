import type {
  ConnectorNote,
  ConnectorNoteInput,
  ConnectorNotesResponse,
} from '@aevra/admin-contracts';
import { requestJson } from './api-client';

function base(actor: string) {
  return `/api/connector-notes/${encodeURIComponent(actor)}`;
}

function notePath(actor: string, id: string) {
  return `${base(actor)}/notes/${encodeURIComponent(id)}`;
}

export function fetchConnectorNotes(actor: string): Promise<ConnectorNotesResponse> {
  return requestJson<ConnectorNotesResponse>(base(actor));
}

export function createConnectorNote(
  actor: string,
  input: ConnectorNoteInput,
): Promise<ConnectorNote> {
  return requestJson(`${base(actor)}/notes`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateConnectorNote(
  actor: string,
  id: string,
  input: ConnectorNoteInput,
): Promise<ConnectorNote> {
  return requestJson(notePath(actor, id), { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteConnectorNote(actor: string, id: string): Promise<{ deleted: true }> {
  return requestJson(notePath(actor, id), { method: 'DELETE' });
}

/** Same-origin image GET; the admin cookie is sent, so a plain `<img src>` works. */
export function connectorNoteImageUrl(actor: string, noteId: string, imageId: string): string {
  return `${notePath(actor, noteId)}/images/${encodeURIComponent(imageId)}`;
}
