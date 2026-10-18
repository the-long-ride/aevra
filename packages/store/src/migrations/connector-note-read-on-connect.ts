/** Per-note "read on connect" flag; replaces the old per-connector setting. */
export const connectorNoteReadOnConnectMigrations = [
  {
    version: 28,
    name: '028_connector_note_read_on_connect',
    sql: 'ALTER TABLE connector_notes ADD COLUMN read_on_connect INTEGER NOT NULL DEFAULT 0;',
  },
];
