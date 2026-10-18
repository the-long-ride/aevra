export type ConnectorNoteImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface ConnectorNoteImage {
  id: string;
  name: string;
  mimeType: ConnectorNoteImageType;
  sizeBytes: number;
}

export interface ConnectorNote {
  id: string;
  actor: string;
  title: string;
  text: string;
  images: ConnectorNoteImage[];
  visibleToAi: boolean;
  aiCanDelete: boolean;
  /** The connect handshake asks the AI to read this note (only while visible). */
  readOnConnect: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorNotesResponse {
  actor: string;
  notes: ConnectorNote[];
}

export interface ConnectorNoteImageUpload {
  name?: string;
  dataBase64: string;
}

export interface ConnectorNoteInput {
  title?: string;
  text?: string;
  /** Existing image ids to keep, in display order (update only). Omitted on update = keep all. */
  keepImageIds?: string[];
  /** New images appended after kept ones. */
  addImages?: ConnectorNoteImageUpload[];
  visibleToAi?: boolean;
  aiCanDelete?: boolean;
  readOnConnect?: boolean;
}
