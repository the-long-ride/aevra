import {
  stringProp,
  hostControlEmptySchema,
  hostLegacyWorkspaceProperties,
  type JsonSchema,
} from './registry-schema-parts.js';

const target = { anyOf: [{ required: ['ref'] }, { required: ['selector'] }] };
const pointTarget = {
  anyOf: [...target.anyOf, { required: ['x', 'y'] }],
};
const actionShapes = {
  click: {
    properties: {
      ref: { type: 'string', minLength: 1 },
      selector: { type: 'string', minLength: 1 },
      x: { type: 'number' },
      y: { type: 'number' },
    },
    required: [] as string[],
    condition: pointTarget,
  },
  drag: {
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      toX: { type: 'number' },
      toY: { type: 'number' },
    },
    required: ['x', 'y', 'toX', 'toY'],
    condition: {},
  },
  type: {
    properties: {
      ref: { type: 'string', minLength: 1 },
      selector: { type: 'string', minLength: 1 },
      text: { type: 'string' },
      clear: { type: 'boolean' },
    },
    required: ['text'],
    condition: target,
  },
  press_key: {
    properties: { key: { type: 'string', minLength: 1 } },
    required: ['key'],
    condition: {},
  },
  scroll: {
    properties: {
      ref: { type: 'string', minLength: 1 },
      selector: { type: 'string', minLength: 1 },
      x: { type: 'number' },
      y: { type: 'number' },
      dx: { type: 'number' },
      dy: { type: 'number' },
    },
    required: ['dx', 'dy'],
    condition: pointTarget,
  },
  select: {
    properties: {
      ref: { type: 'string', minLength: 1 },
      selector: { type: 'string', minLength: 1 },
      value: { type: 'string' },
    },
    required: ['value'],
    condition: target,
  },
  wait_for: {
    properties: {
      ref: { type: 'string', minLength: 1 },
      selector: { type: 'string', minLength: 1 },
      text: { type: 'string', minLength: 1 },
      timeoutMs: { type: 'number', minimum: 0 },
    },
    required: ['timeoutMs'],
    condition: { anyOf: [...target.anyOf, { required: ['text'] }] },
  },
};

const actionVariants = Object.entries(actionShapes).flatMap(([op, shape]) => {
  const payload = {
    type: 'object',
    properties: shape.properties,
    required: shape.required,
    additionalProperties: false,
    ...shape.condition,
  };
  return [
    {
      ...payload,
      properties: { op: { const: op }, ...shape.properties },
      required: ['op', ...shape.required],
    },
    {
      type: 'object',
      properties: { [op]: payload },
      required: [op],
      additionalProperties: false,
    },
  ];
});

/**
 * Input schemas for the ten browser tools, kept apart from the rest so the
 * shared schema module stays inside its line budget.
 */
export const browserInputSchemas: Record<string, JsonSchema> = {
  browser_connect: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      transport: {
        type: 'string',
        enum: ['extension', 'cdp'],
        description: 'Which browser transport to attach to.',
      },
      cdpPort: { type: 'integer', minimum: 1, maximum: 65535, description: 'CDP debugging port.' },
      tabId: stringProp('Optional tab to attach to first.'),
    },
    required: ['transport'],
    additionalProperties: false,
  },
  browser_status: hostControlEmptySchema,
  browser_disconnect: hostControlEmptySchema,
  browser_tabs: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      action: { type: 'string', enum: ['list', 'open', 'close', 'focus'] },
      url: stringProp('URL to open, for action \"open\".'),
      tabId: stringProp('Target tab id.'),
    },
    required: ['action'],
    additionalProperties: false,
  },
  browser_navigate: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      url: stringProp('Absolute URL to navigate to.'),
      waitUntil: { type: 'string', enum: ['load', 'idle'] },
    },
    required: ['url'],
    additionalProperties: false,
  },
  browser_snapshot: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      mode: {
        type: 'string',
        enum: ['a11y', 'vision'],
        description:
          'Use accessibility mode first for element refs. Use vision for canvas, WebGL, or when accessibility has no usable target; extension vision temporarily attaches Chrome debugger.',
      },
      maxNodes: { type: 'integer', minimum: 1, maximum: 2000 },
    },
    additionalProperties: false,
  },
  browser_read: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      ref: stringProp('Element ref from a previous snapshot.'),
      selector: stringProp('CSS selector, when no ref is available.'),
      format: { type: 'string', enum: ['text', 'html'] },
    },
    additionalProperties: false,
  },
  browser_act_many: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      actions: {
        type: 'array',
        minItems: 1,
        items: { oneOf: actionVariants },
        description:
          'Ordered browser actions. Prefer {op:"click",ref:"..."} from an accessibility snapshot, then {op:"click",selector:"..."} for a stable CSS target. Use coordinate click, scroll, or drag as a last resort when canvas-like content has no semantic target or a semantic action failed. Coordinate examples: {op:"click",x:355,y:550}, {op:"drag",x,y,toX,toY}; nested forms are also accepted. Supported ops: click, drag, type, press_key, scroll, select, wait_for.',
      },
      stopOnError: { type: 'boolean' },
    },
    required: ['actions'],
    additionalProperties: false,
  },
  browser_execute_script: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      script: stringProp(
        'Bounded Playwright-like script. Supported: locator(...).click/fill/type/waitFor, getByText(...).waitFor, and keyboard.press. Arbitrary JavaScript is rejected.',
      ),
      stopOnError: { type: 'boolean' },
    },
    required: ['script'],
    additionalProperties: false,
  },
  browser_logs: {
    type: 'object',
    properties: {
      ...hostLegacyWorkspaceProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      kind: { type: 'string', enum: ['console', 'network'] },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      since: stringProp('ISO timestamp lower bound.'),
    },
    additionalProperties: false,
  },
};
