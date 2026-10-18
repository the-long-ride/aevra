export const connectorNotesMigrations = [
  {
    version: 27,
    name: '027_connector_notes',
    sql: `
CREATE TABLE IF NOT EXISTS connector_notes(
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  visible_to_ai INTEGER NOT NULL DEFAULT 1,
  ai_can_delete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_notes_actor_created ON connector_notes(actor, created_at);
CREATE TABLE IF NOT EXISTS connector_note_images(
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES connector_notes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_note_images_note ON connector_note_images(note_id, position);
`,
  },
];
