import { AevraToolError, asToolError } from './errors.js';
import type { FastLaneToolName } from './fast-lane-schemas.js';
import type { McpRuntimeContext } from './service-types.js';

type BatchItemResult = {
  index: number;
  ok: boolean;
  value?: unknown;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  skipped?: boolean;
};

function invalid(message: string): never {
  throw new AevraToolError('INVALID_REQUEST', message);
}

function objectItem(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(`${label} must be an object`);
  }
  return value as Record<string, any>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function optionalInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum?: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    const upper = maximum === undefined ? 'the supported maximum' : String(maximum);
    invalid(`${label} must be an integer between ${minimum} and ${upper}`);
  }
  return value;
}

function itemArray(args: any, key: string, maximum: number): unknown[] {
  const value = args?.[key];
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    invalid(`${key} must contain between 1 and ${maximum} items`);
  }
  return value;
}

function workspaceTarget(args: any) {
  const target: Record<string, string> = {};
  if (typeof args?.workspace === 'string' && args.workspace.trim()) {
    target.workspace = args.workspace.trim();
  }
  if (typeof args?.workspaceId === 'string' && args.workspaceId.trim()) {
    target.workspaceId = args.workspaceId.trim();
  }
  return target;
}

function concurrency(value: unknown, fallback: number, maximum: number) {
  return optionalInteger(value, 'concurrency', 1, maximum) ?? fallback;
}

function serializeError(error: unknown) {
  const value = asToolError(error);
  return {
    code: String(value.code),
    message: value.message,
    ...(value.details ? { details: value.details } : {}),
  };
}

async function runBounded<T>(
  items: readonly T[],
  limit: number,
  failFast: boolean,
  run: (item: T, index: number) => Promise<unknown>,
): Promise<BatchItemResult[]> {
  const results: Array<BatchItemResult | undefined> = new Array(items.length);
  let cursor = 0;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = {
          index,
          ok: true,
          value: await run(items[index]!, index),
        };
      } catch (error) {
        results[index] = { index, ok: false, error: serializeError(error) };
        if (failFast) stopped = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));

  return results.map(
    (result, index) =>
      result ?? {
        index,
        ok: false,
        skipped: true,
      },
  );
}

function summarize(results: BatchItemResult[]) {
  const succeeded = results.filter((item) => item.ok).length;
  const skipped = results.filter((item) => item.skipped).length;
  const failed = results.length - succeeded - skipped;
  return {
    ok: failed === 0 && skipped === 0,
    count: results.length,
    succeeded,
    failed,
    skipped,
    results,
  };
}

function withMetadata(
  results: BatchItemResult[],
  items: Array<Record<string, any>>,
  fields: string[],
) {
  return results.map((result, index) => {
    const metadata = Object.fromEntries(fields.map((field) => [field, items[index]?.[field]]));
    return { ...metadata, ...result };
  });
}

function validateRead(item: unknown, index: number) {
  const value = objectItem(item, `reads[${index}]`);
  const path = stringValue(value.path, `reads[${index}].path`);
  const offset = optionalInteger(value.offset, `reads[${index}].offset`, 0);
  const length = optionalInteger(value.length, `reads[${index}].length`, 0);
  return {
    path,
    ...(offset !== undefined ? { offset } : {}),
    ...(length !== undefined ? { length } : {}),
  };
}

function rejectUnsupportedWriteFields(
  value: Record<string, any>,
  index: number,
  operation: string,
  allowedFields: readonly string[],
) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      invalid(`writes[${index}].${field} is not supported for ${operation}`);
    }
  }
}

function validateWrite(item: unknown, index: number): Record<string, any> {
  const value = objectItem(item, `writes[${index}]`);
  const operation = stringValue(value.operation, `writes[${index}].operation`);
  if (!['create', 'replace', 'patch'].includes(operation)) {
    invalid(`writes[${index}].operation must be create, replace, or patch`);
  }
  const path = stringValue(value.path, `writes[${index}].path`);

  if (operation === 'create') {
    rejectUnsupportedWriteFields(value, index, operation, [
      'operation',
      'path',
      'content',
      'encoding',
    ]);
    if (typeof value.content !== 'string') {
      invalid(`writes[${index}].content is required for create`);
    }
    if (value.encoding !== undefined && !['utf8', 'base64'].includes(String(value.encoding))) {
      invalid(`writes[${index}].encoding must be utf8 or base64`);
    }
    return {
      operation,
      path,
      content: value.content,
      ...(value.encoding !== undefined ? { encoding: value.encoding } : {}),
    };
  }

  if (operation === 'replace') {
    rejectUnsupportedWriteFields(value, index, operation, [
      'operation',
      'path',
      'content',
      'expectedHash',
    ]);
    if (typeof value.content !== 'string') {
      invalid(`writes[${index}].content is required for replace`);
    }
    if (value.expectedHash !== undefined && typeof value.expectedHash !== 'string') {
      invalid(`writes[${index}].expectedHash must be a string`);
    }
    return {
      operation,
      path,
      content: value.content,
      ...(value.expectedHash !== undefined ? { expectedHash: value.expectedHash } : {}),
    };
  }

  rejectUnsupportedWriteFields(value, index, operation, [
    'operation',
    'path',
    'patch',
    'expectedHash',
  ]);
  if (typeof value.patch !== 'string') {
    invalid(`writes[${index}].patch is required for patch`);
  }
  if (value.expectedHash !== undefined && typeof value.expectedHash !== 'string') {
    invalid(`writes[${index}].expectedHash must be a string`);
  }
  return {
    operation,
    path,
    patch: value.patch,
    ...(value.expectedHash !== undefined ? { expectedHash: value.expectedHash } : {}),
  };
}

function validateCommand(item: unknown, index: number) {
  const value = objectItem(item, `commands[${index}]`);
  const executable =
    typeof value.executable === 'string'
      ? value.executable.trim()
      : typeof value.command?.executable === 'string'
        ? value.command.executable.trim()
        : '';
  if (!executable) {
    invalid(`commands[${index}] requires executable or command.executable`);
  }
  return value;
}

export async function handleFastLaneTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: FastLaneToolName,
  args: any,
) {
  const target = workspaceTarget(args);

  if (name === 'file_read_many') {
    const reads = itemArray(args, 'reads', 32).map(validateRead);
    const results = await runBounded(reads, concurrency(args?.concurrency, 8, 8), false, (read) =>
      context.callInner(sessionId, 'file_read', { ...read, ...target }),
    );
    return summarize(withMetadata(results, reads, ['path']));
  }

  if (name === 'file_write_many') {
    const writes = itemArray(args, 'writes', 32).map(validateWrite);
    const seen = new Set<string>();
    for (const write of writes) {
      if (seen.has(write.path)) invalid(`Duplicate write target: ${write.path}`);
      seen.add(write.path);
    }

    const results = await runBounded(
      writes,
      concurrency(args?.concurrency, 8, 8),
      args?.failFast === true,
      (write) => {
        if (write.operation === 'create') {
          return context.callInner(sessionId, 'file_create', {
            path: write.path,
            content: write.content,
            ...(write.encoding !== undefined ? { encoding: write.encoding } : {}),
            ...target,
          });
        }
        if (write.operation === 'replace') {
          return context.callInner(sessionId, 'file_write', {
            path: write.path,
            content: write.content,
            ...(write.expectedHash !== undefined ? { expectedHash: write.expectedHash } : {}),
            ...target,
          });
        }
        return context.callInner(sessionId, 'file_patch', {
          path: write.path,
          patch: write.patch,
          ...(write.expectedHash !== undefined ? { expectedHash: write.expectedHash } : {}),
          ...target,
        });
      },
    );
    return summarize(withMetadata(results, writes, ['operation', 'path']));
  }

  const commands = itemArray(args, 'commands', 16).map(validateCommand);
  const strategy = args?.strategy ?? 'auto';
  if (!['auto', 'parallel', 'sequential'].includes(strategy)) {
    invalid('strategy must be auto, parallel, or sequential');
  }
  const requestedConcurrency = concurrency(args?.concurrency, 4, 4);
  const results = await runBounded(
    commands,
    strategy === 'sequential' ? 1 : requestedConcurrency,
    false,
    (command) => context.callInner(sessionId, 'command_run', { ...command, ...target }),
  );
  return summarize(results);
}
