import {
  stringProp,
  workspaceEmptySchema,
  workspaceTargetProperties,
  type JsonSchema,
} from './registry-schema-parts.js';

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
  desktop_status: workspaceEmptySchema,
  desktop_connect: workspaceEmptySchema,
  desktop_disconnect: workspaceEmptySchema,
  desktop_apps: workspaceEmptySchema,
  desktop_windows: workspaceEmptySchema,
  desktop_describe: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id. Defaults to the focused window.'),
      maxNodes: { type: 'integer', minimum: 1, maximum: 5000 },
      interactiveOnly: { type: 'boolean', description: 'Return only interactive nodes.' },
      mode: {
        type: 'string',
        enum: ['foreground', 'background'],
        description: 'Describe mode: foreground (default) or background.',
      },
    },
    additionalProperties: false,
  },
  desktop_capture: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id. Defaults to the focused window.'),
    },
    additionalProperties: false,
  },
  desktop_click: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      ref: stringProp('Element ref from a previous desktop_describe.'),
      x: { type: 'number', description: 'Screen x-coordinate, when no ref is available.' },
      y: { type: 'number', description: 'Screen y-coordinate, when no ref is available.' },
    },
    additionalProperties: false,
  },
  desktop_type: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      text: stringProp('Text to type into whichever element currently has focus.'),
    },
    required: ['text'],
    additionalProperties: false,
  },
  desktop_key: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      keys: stringProp('Key or key combination to send, e.g. "Enter" or "Ctrl+A".'),
    },
    required: ['keys'],
    additionalProperties: false,
  },
  desktop_scroll: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      deltaY: {
        type: 'number',
        description: 'Vertical scroll delta, delivered wherever the mouse cursor currently is.',
      },
    },
    required: ['deltaY'],
    additionalProperties: false,
  },
  desktop_invoke: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id.'),
      windowLeaseId: stringProp('Window lease id from desktop_describe in background mode.'),
      snapshotId: stringProp('Snapshot id from desktop_describe in background mode.'),
      ref: stringProp('Element ref to invoke.'),
    },
    required: ['windowId', 'windowLeaseId', 'snapshotId', 'ref'],
    additionalProperties: false,
  },
  desktop_set_value: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id.'),
      windowLeaseId: stringProp('Window lease id from desktop_describe in background mode.'),
      snapshotId: stringProp('Snapshot id from desktop_describe in background mode.'),
      ref: stringProp('Element ref to set value on.'),
      value: stringProp('Text value to set on the element.'),
    },
    required: ['windowId', 'windowLeaseId', 'snapshotId', 'ref', 'value'],
    additionalProperties: false,
  },
  desktop_select: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id.'),
      windowLeaseId: stringProp('Window lease id from desktop_describe in background mode.'),
      snapshotId: stringProp('Snapshot id from desktop_describe in background mode.'),
      ref: stringProp('Element ref to select.'),
    },
    required: ['windowId', 'windowLeaseId', 'snapshotId', 'ref'],
    additionalProperties: false,
  },
  desktop_toggle: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id.'),
      windowLeaseId: stringProp('Window lease id from desktop_describe in background mode.'),
      snapshotId: stringProp('Snapshot id from desktop_describe in background mode.'),
      ref: stringProp('Element ref to toggle.'),
    },
    required: ['windowId', 'windowLeaseId', 'snapshotId', 'ref'],
    additionalProperties: false,
  },
  desktop_release_window: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target window id.'),
      windowLeaseId: stringProp('Window lease id to release.'),
    },
    required: ['windowId', 'windowLeaseId'],
    additionalProperties: false,
  },
};
