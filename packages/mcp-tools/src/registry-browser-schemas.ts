import {
  stringProp,
  workspaceEmptySchema,
  workspaceTargetProperties,
  type JsonSchema,
} from './registry-schema-parts.js';

/**
 * Input schemas for the nine browser tools, kept apart from the rest so the
 * shared schema module stays inside its line budget.
 */
export const browserInputSchemas: Record<string, JsonSchema> = {
  browser_connect: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
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
  browser_status: workspaceEmptySchema,
  browser_disconnect: workspaceEmptySchema,
  browser_tabs: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      mode: {
        type: 'string',
        enum: ['a11y', 'vision'],
        description: 'Accessibility tree with refs, or a labelled screenshot.',
      },
      maxNodes: { type: 'integer', minimum: 1, maximum: 2000 },
    },
    additionalProperties: false,
  },
  browser_read: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
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
      ...workspaceTargetProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      actions: {
        type: 'array',
        minItems: 1,
        items: { type: 'object' },
        description:
          'Ordered actions: click {ref|x,y}, type {ref,text,clear}, press_key {key}, scroll {ref|x,y,dx,dy}, select {ref,value}, wait_for {ref|text,timeoutMs}.',
      },
      stopOnError: { type: 'boolean' },
    },
    required: ['actions'],
    additionalProperties: false,
  },
  browser_logs: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      tabId: stringProp('Target tab id. Defaults to the active tab.'),
      kind: { type: 'string', enum: ['console', 'network'] },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      since: stringProp('ISO timestamp lower bound.'),
    },
    additionalProperties: false,
  },
};
