import type { WorkerOperation } from '../../protocol/src/worker.js';
import { authorizeCapability } from './authorization.js';
import { AevraToolError } from './errors.js';
import type { JsonSchema } from './registry-input-schemas.js';
import { requiredLease } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const SEARCH_HARD_MAX_QUERIES = 32;
export const DEFAULT_SEARCH_MAX_QUERIES = 8;

const workspaceTargetProperties = {
  workspace: { type: 'string', description: 'Workspace name for this search.' },
  workspaceId: { type: 'string', description: 'Workspace ID for this search.' },
};

export const searchInputSchema: JsonSchema = {
  type: 'object',
  properties: {
    ...workspaceTargetProperties,
    path: { type: 'string', description: 'Logical workspace path to search. Defaults to /.' },
    queries: {
      type: 'array',
      minItems: 1,
      maxItems: SEARCH_HARD_MAX_QUERIES,
      description: 'Search values executed concurrently through native search tooling.',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string', minLength: 1 },
          mode: { type: 'string', enum: ['text', 'regex', 'files'] },
          path: { type: 'string', description: 'Optional path override for this value.' },
        },
        required: ['value'],
        additionalProperties: false,
      },
    },
    maxResultsPerQuery: { type: 'integer', minimum: 1, maximum: 200 },
  },
  required: ['queries'],
  additionalProperties: false,
};

function configuredMax(context: McpRuntimeContext) {
  const settings = context.deps.settings?.get<Record<string, unknown>>('execution.settings', {});
  const raw = Number(settings?.searchMaxQueries ?? DEFAULT_SEARCH_MAX_QUERIES);
  const value = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_SEARCH_MAX_QUERIES;
  return Math.max(1, Math.min(SEARCH_HARD_MAX_QUERIES, value));
}

function normalizeQueries(args: any, max: number) {
  const input = Array.isArray(args?.queries) ? args.queries : [];
  if (!input.length || input.length > max) {
    throw new AevraToolError('INVALID_REQUEST', `search accepts between 1 and ${max} queries`, {
      maxQueries: max,
    });
  }
  return input.map((entry: any, index: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new AevraToolError('INVALID_REQUEST', `search query ${index + 1} must be an object`);
    }
    const value = String(entry.value ?? '').trim();
    if (!value) {
      throw new AevraToolError('INVALID_REQUEST', `search query ${index + 1} requires a value`);
    }
    const mode = entry.mode ?? 'text';
    if (mode !== 'text' && mode !== 'regex' && mode !== 'files') {
      throw new AevraToolError('INVALID_REQUEST', `Unsupported search mode: ${String(mode)}`);
    }
    return {
      value,
      mode,
      path: String(entry.path ?? args.path ?? '/'),
    } as const;
  });
}

export async function searchTool(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
) {
  const max = configuredMax(context);
  const queries = normalizeQueries(args, max);
  const gate = await authorizeCapability(
    context,
    sessionId,
    'files.search',
    { tool: 'search', args },
    '*',
    'LOW',
  );
  if ('response' in gate) return gate.response;

  const lease = requiredLease(context, sessionId);
  const maxResultsPerQuery = Math.max(1, Math.min(200, Number(args.maxResultsPerQuery) || 50));
  const operation: WorkerOperation = { kind: 'search.multi', queries, maxResultsPerQuery };
  const result = await context.worker.execute({
    sessionId,
    workspaceId: lease.workspaceId,
    roots: context.workspaces.capabilityRoots(lease.workspaceId),
    operation,
    executionMode: 'host',
  });
  if (!result.ok) {
    throw new AevraToolError(result.error.code, result.error.message, result.error.details);
  }
  return result.value;
}
