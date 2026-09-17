import { emptySchema, stringProp, type JsonSchema } from './registry-schema-parts.js';

/**
 * Input schemas for the ten desktop tools, kept apart from the rest so the
 * shared schema module stays inside its line budget.
 *
 * `desktop_type` and `desktop_scroll` take no `ref`/`x`/`y`: only
 * `desktop_click` resolves a handle or a coordinate in `helper/src/act.rs`.
 * `perform()`'s `type` and `scroll` arms read only `text` and `deltaY`
 * respectively and silently ignore anything else on the request, so a
 * schema that advertised those fields here would promise element targeting
 * neither op implements - a caller passing `ref` to `desktop_type` would see
 * no error and no targeting, just text landing wherever focus already was.
 */
export const desktopInputSchemas: Record<string, JsonSchema> = {
  desktop_status: emptySchema,
  desktop_connect: emptySchema,
  desktop_disconnect: emptySchema,
  desktop_apps: emptySchema,
  desktop_windows: emptySchema,
  desktop_describe: {
    type: 'object',
    properties: {
      windowId: stringProp('Target window id. Defaults to the focused window.'),
      maxNodes: { type: 'integer', minimum: 1, maximum: 5000 },
      interactiveOnly: { type: 'boolean', description: 'Return only interactive nodes.' },
    },
    additionalProperties: false,
  },
  desktop_capture: {
    type: 'object',
    properties: {
      windowId: stringProp('Target window id. Defaults to the focused window.'),
    },
    additionalProperties: false,
  },
  desktop_click: {
    type: 'object',
    properties: {
      ref: stringProp('Element ref from a previous desktop_describe.'),
      x: { type: 'number', description: 'Screen x-coordinate, when no ref is available.' },
      y: { type: 'number', description: 'Screen y-coordinate, when no ref is available.' },
    },
    additionalProperties: false,
  },
  desktop_type: {
    type: 'object',
    properties: {
      text: stringProp('Text to type into whichever element currently has focus.'),
    },
    required: ['text'],
    additionalProperties: false,
  },
  desktop_key: {
    type: 'object',
    properties: {
      keys: stringProp('Key or key combination to send, e.g. "Enter" or "Ctrl+A".'),
    },
    required: ['keys'],
    additionalProperties: false,
  },
  desktop_scroll: {
    type: 'object',
    properties: {
      deltaY: {
        type: 'number',
        description: 'Vertical scroll delta, delivered wherever the mouse cursor currently is.',
      },
    },
    required: ['deltaY'],
    additionalProperties: false,
  },
};
