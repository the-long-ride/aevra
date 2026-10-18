import type {
  ConnectorNote,
  ConnectorNoteImageType,
  ConnectorNotesResponse,
} from '../../../../packages/admin-contracts/src/connector-notes.js';
import type { ConnectorNotesRepository } from '../../../../packages/store/src/connector-notes.js';
import { invalidNote, noteNotFound } from '../../../../packages/store/src/connector-note-rules.js';
import { isValidConnectorActor } from './connector-profiles.js';

export interface VisibleNoteImage {
  id: string;
  name: string;
  mimeType: ConnectorNoteImageType;
  data: Uint8Array;
}
export interface VisibleNote extends Omit<ConnectorNote, 'images'> {
  images: Array<{ id: string; name: string; mimeType: ConnectorNoteImageType }>;
}
export type AiDeleteOutcome = 'deleted' | 'not_found' | 'not_deletable';

function checkActor(actor: unknown): string {
  if (!isValidConnectorActor(actor)) throw invalidNote('Invalid connector actor.');
  return actor;
}

/**
 * Admin-owned notes per connector actor. Each note carries its own switches.
 * The AI-facing methods never throw for a bad actor: they see nothing.
 */
export class ConnectorNotesService {
  constructor(private readonly repo: ConnectorNotesRepository) {}

  notes(actor: string): ConnectorNotesResponse {
    const key = checkActor(actor);
    return { actor: key, notes: this.repo.list(key) };
  }

  create(actor: string, input: unknown): ConnectorNote {
    return this.repo.create(checkActor(actor), input);
  }

  update(actor: string, id: string, input: unknown): ConnectorNote {
    return this.repo.update(checkActor(actor), id, input);
  }

  delete(actor: string, id: string): void {
    if (!this.repo.delete(checkActor(actor), id)) throw noteNotFound();
  }

  image(actor: string, noteId: string, imageId: string) {
    return this.repo.image(checkActor(actor), noteId, imageId);
  }

  listVisible(actor: string): VisibleNote[] {
    if (!isValidConnectorActor(actor)) return [];
    return this.repo
      .list(actor)
      .filter((note) => note.visibleToAi)
      .map((note) => ({
        ...note,
        images: note.images.map(({ id, name, mimeType }) => ({ id, name, mimeType })),
      }));
  }

  readVisible(
    actor: string,
    id: string,
  ): (Omit<VisibleNote, 'images'> & { images: VisibleNoteImage[] }) | undefined {
    if (!isValidConnectorActor(actor)) return undefined;
    const note = this.repo.get(actor, id);
    if (!note?.visibleToAi) return undefined;
    const images: VisibleNoteImage[] = [];
    for (const image of note.images) {
      const stored = this.repo.image(actor, id, image.id);
      if (stored)
        images.push({
          id: image.id,
          name: image.name,
          mimeType: stored.mimeType,
          data: stored.bytes,
        });
    }
    return { ...note, images };
  }

  deleteByAi(actor: string, id: string): AiDeleteOutcome {
    if (!isValidConnectorActor(actor)) return 'not_found';
    const note = this.repo.get(actor, id);
    if (!note?.visibleToAi) return 'not_found';
    if (!note.aiCanDelete) return 'not_deletable';
    return this.repo.delete(actor, id) ? 'deleted' : 'not_found';
  }

  /**
   * Text the connect handshake appends, or null. Only visible notes the user
   * flagged "read on connect" count; other notes wait until the user asks.
   */
  connectNotice(actor: string): string | null {
    const count = this.listVisible(actor).filter((note) => note.readOnConnect).length;
    if (!count) return null;
    return `This connector has ${count} note(s) the user wants read on connect. Call notes_list, then notes_read for each note with readOnConnect true, before starting other work.`;
  }
}
