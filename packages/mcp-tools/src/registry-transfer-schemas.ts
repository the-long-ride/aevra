import { workspaceTargetProperties, type JsonSchema } from './registry-schema-parts.js';

// Kept terse on purpose: tools/list has a size budget (registry-advertised contract test).
const entryProperties = {
  path: { type: 'string' },
  mimeType: { type: 'string' },
  overwrite: { type: 'boolean' },
  content: { type: 'string', description: 'base64' },
  encoding: { type: 'string', enum: ['base64'] },
  url: { type: 'string', description: 'public http(s)' },
  headers: { type: 'object', additionalProperties: { type: 'string' } },
};

/**
 * `files_download`: the agent sends files to this device. Each entry carries either
 * inline base64 content or a public URL, not both.
 */
export const filesDownloadInputSchema: JsonSchema = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        properties: entryProperties,
        required: ['path', 'mimeType'],
        additionalProperties: false,
      },
    },
    ...workspaceTargetProperties,
  },
  required: ['entries'],
  additionalProperties: false,
};

/** `files_upload`: the agent pulls files from this device, inline or by one-time link. */
export const filesUploadInputSchema: JsonSchema = {
  type: 'object',
  properties: {
    paths: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
    delivery: { type: 'string', enum: ['auto', 'inline', 'link'] },
    ...workspaceTargetProperties,
  },
  required: ['paths'],
  additionalProperties: false,
};

export const transferResultOutputSchema: JsonSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    count: { type: 'integer' },
    succeeded: { type: 'integer' },
    failed: { type: 'integer' },
    results: { type: 'array' },
  },
  required: ['ok', 'results'],
};
