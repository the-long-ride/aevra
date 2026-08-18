import { createHash } from 'node:crypto';
import type { Capability, RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import {
  classifySensitivity,
  maskSecretFile,
} from '../../security/src/sensitive.js';
import { authorizeCapability, gated } from './authorization.js';
import { AevraToolError } from './errors.js';
import {
  argsHash,
  requiredLease,
  unavailable,
} from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const FILE_TOOL_NAMES = new Set([
  'file_list',
  'file_read',
  'file_search',
  'file_write',
  'file_create',
  'file_move',
  'file_patch',
  'file_delete',
]);

export async function handleFileTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (['file_list', 'file_read', 'file_search'].includes(name)) {
    const capability: Capability =
      name === 'file_search' ? 'files.search' : 'files.read';
    const gate = await authorizeCapability(
      context,
      sessionId,
      capability,
      { tool: name, args },
      '*',
      'LOW',
    );
    if ('response' in gate) return gate.response;
    return readTool(context, sessionId, name, args);
  }

  if (name === 'file_write') {
    const gate = await writeGate(context, sessionId, name, args);
    if ('response' in gate) return gate.response;
    return (
      context.deps.operations?.write(
        sessionId,
        {
          path: String(args.path),
          content: String(args.content ?? ''),
          expectedHash: args.expectedHash,
        },
        gate.authorization,
      ) ?? unavailable(name)
    );
  }

  if (name === 'file_create') {
    const gate = await writeGate(context, sessionId, name, args);
    if ('response' in gate) return gate.response;
    return (
      context.deps.operations?.create(
        sessionId,
        {
          path: String(args.path),
          content: String(args.content ?? ''),
          encoding: args.encoding === 'base64' ? 'base64' : 'utf8',
        },
        gate.authorization,
      ) ?? unavailable(name)
    );
  }

  if (name === 'file_move') {
    const gate = await writeGate(context, sessionId, name, args);
    if ('response' in gate) return gate.response;
    return (
      context.deps.operations?.move(
        sessionId,
        { from: String(args.from), to: String(args.to) },
        gate.authorization,
      ) ?? unavailable(name)
    );
  }

  if (name === 'file_patch') {
    const gate = await writeGate(context, sessionId, name, args);
    if ('response' in gate) return gate.response;
    return (
      context.deps.operations?.patch(
        sessionId,
        {
          path: String(args.path),
          patch: String(args.patch ?? ''),
          expectedHash: args.expectedHash,
        },
        gate.authorization,
      ) ?? unavailable(name)
    );
  }

  const risk: RiskTier = Boolean(args.recursive) ? 'HIGH' : 'MEDIUM';
  const gate = await authorizeCapability(
    context,
    sessionId,
    'files.delete',
    { tool: name, args },
    '*',
    risk,
  );
  if ('response' in gate) return gate.response;
  return gated(
    context,
    sessionId,
    {
      family: 'files:delete',
      capability: 'files.delete',
      risk,
      argsHash: argsHash(args),
    },
    { tool: name, args },
    {},
    () =>
      context.deps.operations!.delete(
        sessionId,
        {
          path: String(args.path),
          recursive: Boolean(args.recursive),
        },
        gate.authorization,
      ),
  );
}

async function writeGate(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  return authorizeCapability(
    context,
    sessionId,
    'files.write',
    { tool: name, args },
    '*',
    'MEDIUM',
  );
}

async function readTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  const lease = requiredLease(context, sessionId);
  const roots = context.workspaces.capabilityRoots(lease.workspaceId);
  const operation: WorkerOperation =
    name === 'file_list'
      ? { kind: 'file.list', path: String(args.path ?? '/') }
      : name === 'file_read'
        ? { kind: 'file.read', path: String(args.path) }
        : {
            kind: 'file.search',
            path: String(args.path ?? '/'),
            query: String(args.query ?? ''),
          };
  const result = await context.worker.execute({
    sessionId,
    workspaceId: lease.workspaceId,
    roots,
    operation,
    executionMode: 'host',
  });
  if (!result.ok) {
    throw new AevraToolError(
      result.error.code,
      result.error.message,
      result.error.details,
    );
  }
  if (name !== 'file_read') return result.value;

  const value = result.value as any;
  const sensitivity = classifySensitivity({ path: value.path });
  const content =
    sensitivity === 'SECRET'
      ? maskSecretFile(value.path, value.content)
      : value.content;
  if (args.offset !== undefined || args.length !== undefined) {
    const offset = Math.max(0, Number(args.offset ?? 0) || 0);
    const length =
      args.length === undefined
        ? Math.max(0, content.length - offset)
        : Math.max(0, Number(args.length) || 0);
    const chunk = content.slice(offset, offset + length);
    return {
      path: value.path,
      hash: createHash('sha256').update(chunk).digest('hex'),
      offset,
      length: chunk.length,
      totalLength: content.length,
      content: chunk,
      sensitivity,
    };
  }

  context.reads.put({
    sessionId,
    workspaceId: lease.workspaceId,
    path: value.path,
    hash: value.hash,
    content: value.content,
    storedAt: Date.now(),
  });
  return { ...value, content, sensitivity };
}
