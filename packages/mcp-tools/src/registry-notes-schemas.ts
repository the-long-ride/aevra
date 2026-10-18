import { emptySchema, type JsonSchema } from './registry-schema-parts.js';

const noteIdSchema: JsonSchema = {
  type: 'object',
  properties: { id: { type: 'string', description: 'Note id.' } },
  required: ['id'],
  additionalProperties: false,
};

export const notesInputSchemas: Record<string, JsonSchema> = {
  notes_list: emptySchema,
  notes_read: noteIdSchema,
  notes_delete: noteIdSchema,
};
