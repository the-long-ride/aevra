import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  invalidNote,
  nextAutoTitle,
  NOTE_LIMITS,
  noteNotFound,
  parseNoteInput,
  type NoteImageType,
  type ParsedImage,
} from './connector-note-rules.js';

export interface ConnectorNoteImageRecord {
  id: string;
  name: string;
  mimeType: NoteImageType;
  sizeBytes: number;
}
export interface ConnectorNoteRecord {
  id: string;
  actor: string;
  title: string;
  text: string;
  images: ConnectorNoteImageRecord[];
  visibleToAi: boolean;
  aiCanDelete: boolean;
  readOnConnect: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface ConnectorNoteImageBytes {
  bytes: Buffer;
  mimeType: NoteImageType;
}

const NOTE_COLUMNS =
  'id,actor,title,body,visible_to_ai,ai_can_delete,read_on_connect,created_at,updated_at';
const IMAGE_COLUMNS = 'i.note_id,i.id,i.name,i.mime_type,i.size_bytes';

function toImage(raw: Record<string, any>): ConnectorNoteImageRecord {
  return {
    id: String(raw.id),
    name: String(raw.name),
    mimeType: raw.mime_type as NoteImageType,
    sizeBytes: Number(raw.size_bytes),
  };
}

function toNote(raw: Record<string, any>, images: ConnectorNoteImageRecord[]): ConnectorNoteRecord {
  return {
    id: String(raw.id),
    actor: String(raw.actor),
    title: String(raw.title),
    text: String(raw.body),
    images,
    visibleToAi: Number(raw.visible_to_ai) === 1,
    aiCanDelete: Number(raw.ai_can_delete) === 1,
    readOnConnect: Number(raw.read_on_connect) === 1,
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at),
  };
}

/** Notes an admin leaves for the AI behind one connector actor. Deletes are permanent. */
export class ConnectorNotesRepository {
  private readonly now: () => Date;

  constructor(
    private readonly db: DatabaseSync,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  list(actor: string): ConnectorNoteRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${NOTE_COLUMNS} FROM connector_notes WHERE actor=? ORDER BY created_at DESC, rowid DESC`,
      )
      .all(actor) as Array<Record<string, any>>;
    const images = this.db
      .prepare(
        `SELECT ${IMAGE_COLUMNS} FROM connector_note_images i JOIN connector_notes n ON n.id=i.note_id WHERE n.actor=? ORDER BY i.position`,
      )
      .all(actor) as Array<Record<string, any>>;
    const byNote = new Map<string, ConnectorNoteImageRecord[]>();
    for (const image of images) {
      const list = byNote.get(String(image.note_id)) ?? [];
      list.push(toImage(image));
      byNote.set(String(image.note_id), list);
    }
    return rows.map((row) => toNote(row, byNote.get(String(row.id)) ?? []));
  }

  get(actor: string, id: string): ConnectorNoteRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${NOTE_COLUMNS} FROM connector_notes WHERE actor=? AND id=?`)
      .get(actor, id) as Record<string, any> | undefined;
    return row ? toNote(row, this.imagesOf(id)) : undefined;
  }

  countByActor(actor: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) n FROM connector_notes WHERE actor=?')
      .get(actor) as { n: number };
    return Number(row.n);
  }

  create(actor: string, input: unknown): ConnectorNoteRecord {
    const parsed = parseNoteInput(input);
    if (parsed.keepImageIds !== undefined) {
      throw invalidNote('keepImageIds is only used when updating a note.');
    }
    const text = parsed.text ?? '';
    this.requireContent(text, parsed.addImages.length);
    const id = randomUUID();
    this.transaction(() => {
      if (this.countByActor(actor) >= NOTE_LIMITS.notesPerActor) {
        throw invalidNote(`A connector can keep at most ${NOTE_LIMITS.notesPerActor} notes.`);
      }
      const stamp = this.now().toISOString();
      this.db
        .prepare(`INSERT INTO connector_notes(${NOTE_COLUMNS}) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(
          id,
          actor,
          parsed.title || this.autoTitle(actor),
          text,
          parsed.visibleToAi === false ? 0 : 1,
          parsed.aiCanDelete === true ? 1 : 0,
          parsed.readOnConnect === true ? 1 : 0,
          stamp,
          stamp,
        );
      this.insertImages(id, parsed.addImages, 1);
    });
    return this.get(actor, id)!;
  }

  update(actor: string, id: string, input: unknown): ConnectorNoteRecord {
    const parsed = parseNoteInput(input);
    const current = this.get(actor, id);
    if (!current) throw noteNotFound();
    const existing = new Set(current.images.map((image) => image.id));
    const kept = parsed.keepImageIds ?? current.images.map((image) => image.id);
    for (const imageId of kept) {
      if (!existing.has(imageId)) throw invalidNote(`Unknown image id: ${imageId}.`);
    }
    const total = kept.length + parsed.addImages.length;
    if (total > NOTE_LIMITS.imagesPerNote) {
      throw invalidNote(`A note can have at most ${NOTE_LIMITS.imagesPerNote} images.`);
    }
    const text = parsed.text ?? current.text;
    this.requireContent(text, total);
    let title = current.title;
    if (parsed.title !== undefined) title = parsed.title || this.autoTitle(actor, id);
    this.transaction(() => {
      this.db
        .prepare(
          'UPDATE connector_notes SET title=?,body=?,visible_to_ai=?,ai_can_delete=?,read_on_connect=?,updated_at=? WHERE id=? AND actor=?',
        )
        .run(
          title,
          text,
          (parsed.visibleToAi ?? current.visibleToAi) ? 1 : 0,
          (parsed.aiCanDelete ?? current.aiCanDelete) ? 1 : 0,
          (parsed.readOnConnect ?? current.readOnConnect) ? 1 : 0,
          this.now().toISOString(),
          id,
          actor,
        );
      const keep = new Set(kept);
      for (const imageId of existing) {
        if (!keep.has(imageId)) {
          this.db
            .prepare('DELETE FROM connector_note_images WHERE id=? AND note_id=?')
            .run(imageId, id);
        }
      }
      kept.forEach((imageId, index) => {
        this.db
          .prepare('UPDATE connector_note_images SET position=? WHERE id=? AND note_id=?')
          .run(index + 1, imageId, id);
      });
      this.insertImages(id, parsed.addImages, kept.length + 1);
    });
    return this.get(actor, id)!;
  }

  /** Hard delete; images go with the note through ON DELETE CASCADE. */
  delete(actor: string, id: string): boolean {
    let changes = 0;
    this.transaction(() => {
      changes = Number(
        this.db.prepare('DELETE FROM connector_notes WHERE id=? AND actor=?').run(id, actor)
          .changes,
      );
    });
    return changes > 0;
  }

  image(actor: string, noteId: string, imageId: string): ConnectorNoteImageBytes | undefined {
    const row = this.db
      .prepare(
        'SELECT i.data,i.mime_type FROM connector_note_images i JOIN connector_notes n ON n.id=i.note_id WHERE n.actor=? AND n.id=? AND i.id=?',
      )
      .get(actor, noteId, imageId) as { data: Uint8Array; mime_type: string } | undefined;
    return row
      ? { bytes: Buffer.from(row.data), mimeType: row.mime_type as NoteImageType }
      : undefined;
  }

  private imagesOf(noteId: string): ConnectorNoteImageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${IMAGE_COLUMNS} FROM connector_note_images i WHERE i.note_id=? ORDER BY i.position`,
      )
      .all(noteId) as Array<Record<string, any>>;
    return rows.map(toImage);
  }

  private autoTitle(actor: string, excludeId?: string): string {
    const rows = this.db
      .prepare("SELECT title FROM connector_notes WHERE actor=? AND id<>? AND title LIKE 'note-%'")
      .all(actor, excludeId ?? '') as Array<{ title: string }>;
    return nextAutoTitle(rows.map((row) => row.title));
  }

  private requireContent(text: string, imageCount: number) {
    if (!text.trim() && imageCount === 0) {
      throw invalidNote('A note needs text or at least one image.');
    }
  }

  private insertImages(noteId: string, images: ParsedImage[], firstPosition: number) {
    const insert = this.db.prepare(
      'INSERT INTO connector_note_images(id,note_id,position,name,mime_type,size_bytes,data) VALUES(?,?,?,?,?,?,?)',
    );
    images.forEach((image, index) => {
      const position = firstPosition + index;
      insert.run(
        randomUUID(),
        noteId,
        position,
        image.name ?? `image-${position}`,
        image.mimeType,
        image.bytes.length,
        image.bytes,
      );
    });
  }

  private transaction(work: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
