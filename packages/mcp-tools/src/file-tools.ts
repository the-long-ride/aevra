import type { Capability, RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import {
  classifySensitivity,
  maskSensitiveFile,
  maxSensitivity,
  type Sensitivity,
} from '../../security/src/sensitive.js';
import { authorizeCapability, authorizeImmutableSecurityApproval, gated } from './authorization.js';
import { AevraToolError } from './errors.js';
import { argsHash, requiredLease, unavailable } from './service-helpers.js';
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

type FileSecurityOperation = 'read' | 'search' | 'write' | 'patch' | 'move' | 'delete';

function resourceSecurity(
  context: McpRuntimeContext,
  sessionId: string,
  capability: Capability,
  operation: FileSecurityOperation,
  logicalPath: string,
  mutation: boolean,
) {
  if (context.deps.security) {
    return context.deps.security.authorizeResource({
      sessionId,
      capability,
      operation,
      logicalPath,
      mutation,
    });
  }
  const lease = requiredLease(context, sessionId);
  const sensitivity = classifySensitivity({ path: logicalPath });
  return {
    workspaceId: lease.workspaceId,
    capability,
    sensitivity,
    decision:
      sensitivity === 'SECRET'
        ? ('deny' as const)
        : sensitivity === 'SENSITIVE' && mutation
          ? ('approval-required' as const)
          : ('allow' as const),
    ...(sensitivity === 'SENSITIVE' && mutation ? { approvalScope: 'once' as const } : {}),
  };
}

function denySecret(path: string): never {
  throw new AevraToolError(
    'CAPABILITY_REQUIRED',
    `Protected secret resource cannot be accessed remotely: ${path}`,
  );
}

function returnedSensitivity(value: unknown): Sensitivity {
  return value === 'SECRET' || value === 'SENSITIVE' ? value : 'NORMAL';
}

async function mutationSecurityGate(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
  capability: 'files.write' | 'files.delete',
  operation: 'write' | 'patch' | 'move' | 'delete',
  path: string,
) {
  const security = resourceSecurity(context, sessionId, capability, operation, path, true);
  if (security.decision === 'deny') denySecret(path);
  if (security.decision !== 'approval-required') return null;
  return authorizeImmutableSecurityApproval(
    context,
    sessionId,
    capability,
    { tool: name, args },
    `security:sensitive:${name}`,
    'HIGH',
  );
}

export async function handleFileTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (['file_list', 'file_read', 'file_search'].includes(name)) {
    const capability: Capability = name === 'file_search' ? 'files.search' : 'files.read';
    const path = String(args.path ?? (name === 'file_read' ? '' : '/'));
    const operation = name === 'file_search' ? 'search' : 'read';
    const security = resourceSecurity(context, sessionId, capability, operation, path, false);
    if (security.decision === 'deny') denySecret(path);
    const gate = await authorizeCapability(
      context,
      sessionId,
      capability,
      { tool: name, args },
      '*',
      'LOW',
    );
    if ('response' in gate) return gate.response;
    return readTool(context, sessionId, name, args, security.sensitivity);
  }

  if (name === 'file_write' || name === 'file_create') {
    const path = String(args.path);
    const securityGate = await mutationSecurityGate(
      context,
      sessionId,
      name,
      args,
      'files.write',
      'write',
      path,
    );
    if (securityGate && 'response' in securityGate) return securityGate.response;
    const gate = await writeGate(context, sessionId, name, args);
    if ('response' in gate) return gate.response;
    if (name === 'file_write') {
      return (
        context.deps.operations?.write(
          sessionId,
          {
            path,
            content: String(args.content ?? ''),
            expectedHash: args.expectedHash,
          },
          gate.authorization,
        ) ?? unavailable(name)
      );
    }
    return (
      context.deps.operations?.create(
        sessionId,
        {
          path,
          content: String(args.content ?? ''),
          encoding: args.encoding === 'base64' ? 'base64' : 'utf8',
        },
        gate.authorization,
      ) ?? unavailable(name)
    );
  }

  if (name === 'file_move') {
    for (const path of [String(args.from), String(args.to)]) {
      const securityGate = await mutationSecurityGate(
        context,
        sessionId,
        name,
        args,
        'files.write',
        'move',
        path,
      );
      if (securityGate && 'response' in securityGate) return securityGate.response;
    }
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
    const path = String(args.path);
    const securityGate = await mutationSecurityGate(
      context,
      sessionId,
      name,
      args,
      'files.write',
      'patch',
      path,
    );
    if (securityGate && 'response' in securityGate) return securityGate.response;
    const gate = await writeGate(context, sessionId, name, args);
    if ('response' in gate) return gate.response;
    return (
      context.deps.operations?.patch(
        sessionId,
        {
          path,
          patch: String(args.patch ?? ''),
          expectedHash: args.expectedHash,
        },
        gate.authorization,
      ) ?? unavailable(name)
    );
  }

  const path = String(args.path);
  const securityGate = await mutationSecurityGate(
    context,
    sessionId,
    name,
    args,
    'files.delete',
    'delete',
    path,
  );
  if (securityGate && 'response' in securityGate) return securityGate.response;
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
        { path, recursive: Boolean(args.recursive) },
        gate.authorization,
      ),
  );
}

async function writeGate(context: McpRuntimeContext, sessionId: string, name: string, args: any) {
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
  requestedSensitivity: Sensitivity,
) {
  const lease = requiredLease(context, sessionId);
  const roots = context.workspaces.capabilityRoots(lease.workspaceId);
  const operation: WorkerOperation =
    name === 'file_list'
      ? { kind: 'file.list', path: String(args.path ?? '/') }
      : name === 'file_read'
        ? {
            kind: 'file.read',
            path: String(args.path),
            ...(args.offset !== undefined ? { offset: Math.max(0, Number(args.offset) || 0) } : {}),
            ...(args.length !== undefined ? { length: Math.max(0, Number(args.length) || 0) } : {}),
          }
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
    throw new AevraToolError(result.error.code, result.error.message, result.error.details);
  }
  if (name !== 'file_read') return result.value;

  const value = result.value as any;
  const sensitivity = maxSensitivity(
    requestedSensitivity,
    returnedSensitivity(value.sensitivity),
    classifySensitivity({ path: String(value.path ?? args.path ?? '') }),
  );
  if (sensitivity === 'SECRET') denySecret(String(args.path ?? value.path ?? ''));
  const content =
    sensitivity === 'SENSITIVE'
      ? maskSensitiveFile(String(args.path ?? value.path ?? ''), String(value.content ?? ''))
      : value.content;
  const ranged = args.offset !== undefined || args.length !== undefined;
  if (ranged) {
    return {
      ...value,
      content,
      offset: Number(value.offset ?? Math.max(0, Number(args.offset ?? 0) || 0)),
      length: Number(value.length ?? String(content ?? '').length),
      totalLength: Number(value.totalLength ?? String(content ?? '').length),
      sensitivity,
    };
  }

  if (sensitivity === 'NORMAL') {
    context.reads.put({
      sessionId,
      workspaceId: lease.workspaceId,
      path: String(args.path ?? value.path),
      hash: value.hash,
      content: value.content,
      storedAt: Date.now(),
    });
  }
  return { ...value, path: String(args.path ?? value.path), content, sensitivity };
}
