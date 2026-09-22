import { stringProp, workspaceTargetProperties, type JsonSchema } from './registry-schema-parts.js';

const controlMode = {
  type: 'string',
  enum: ['sharedSemantic', 'isolated'],
  description:
    'Execution mode. sharedSemantic uses semantic provider actions in the existing session; isolated requires a verified isolated runner.',
} satisfies JsonSchema;

const planIdSchema: JsonSchema = {
  type: 'object',
  properties: {
    ...workspaceTargetProperties,
    planId: stringProp('Owned control plan id.'),
  },
  required: ['planId'],
  additionalProperties: false,
};

export const controlInputSchemas: Record<string, JsonSchema> = {
  control_observe: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      kind: {
        type: 'string',
        enum: ['browser', 'desktop'],
        description: 'Surface kind to observe.',
      },
      tabId: stringProp('Browser tab id. Defaults to the active tab for browser surfaces.'),
      windowId: stringProp('Desktop window id. Required for desktop surfaces.'),
      mode: controlMode,
      detail: {
        type: 'string',
        enum: ['interactive', 'full'],
        description: 'Return interactive controls only, or the full bounded semantic projection.',
      },
      includeImage: {
        type: 'boolean',
        description:
          'Request visual evidence when the adapter supports it. Current v1.1.1 control observations keep images explicit through capture/snapshot tools.',
      },
      maxOutputTokens: {
        type: 'integer',
        minimum: 1,
        maximum: 4000,
        description: 'Approximate upper bound for the model-facing observation projection.',
      },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  control_execute: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      plan: {
        type: 'object',
        description:
          'Strict schema-version-1 ControlPlan. Runtime validation rejects unknown keys, oversized/cyclic graphs, ambiguous targets, and unsupported modes before mutation.',
      },
    },
    required: ['plan'],
    additionalProperties: false,
  },
  control_plan_status: planIdSchema,
  control_plan_cancel: planIdSchema,
  desktop_act_many: {
    type: 'object',
    properties: {
      ...workspaceTargetProperties,
      windowId: stringProp('Target desktop window id.'),
      requestId: stringProp('Optional idempotency key for the batch.'),
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        items: { type: 'object' },
        description:
          'Ordered shared-semantic desktop actions. Each action uses a current ref or exact unique locator and one of invoke, click, setValue, type, select, setToggleState. Optional preconditions/postcondition remain finite typed predicates.',
      },
      stopOnError: {
        type: 'boolean',
        description: 'Default true. When true, each action depends on the prior action.',
      },
      deadlineMs: {
        type: 'integer',
        minimum: 1000,
        maximum: 60000,
        description: 'Overall local execution deadline.',
      },
      maxOutputTokens: {
        type: 'integer',
        minimum: 1,
        maximum: 4000,
        description: 'Approximate bound for the returned semantic delta.',
      },
    },
    required: ['windowId', 'actions'],
    additionalProperties: false,
  },
};
