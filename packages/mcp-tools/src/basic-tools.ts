import { authorizeCapability, gated, workspaceSelect } from './authorization.js';
import { AevraToolError } from './errors.js';
import { argsHash, unavailable, workspaceRoot } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const BASIC_TOOL_NAMES = new Set([
  'aevra_status',
  'skills_list',
  'skill_read',
  'skill_write',
  'instructions_read',
  'instructions_write',
  'approval_status',
  'approval_cancel',
  'approval_wait',
  'workspace_list',
  'workspace_current',
  'workspace_select',
]);

async function authorizeRead(
  context: McpRuntimeContext,
  sessionId: string,
  capability: 'skills.read' | 'instructions.read',
  tool: string,
  args: any,
  matcher: string,
) {
  if (!context.sessions.activeLease(sessionId)) return null;
  return authorizeCapability(context, sessionId, capability, { tool, args }, matcher, 'LOW');
}

function auditContextWrite(
  context: McpRuntimeContext,
  sessionId: string,
  tool: 'skill_write' | 'instructions_write',
  target: string,
) {
  const session = context.sessions.get(sessionId),
    lease = context.sessions.activeLease(sessionId);
  context.deps.audit?.append({
    actor: session?.actor,
    sessionId,
    workspaceId: lease?.workspaceId,
    tool,
    operation: tool,
    target,
    risk: 'HIGH',
    decision: 'allowed',
    result: 'ok',
    redactionCount: 0,
  });
}

async function authorizeWrite(
  context: McpRuntimeContext,
  sessionId: string,
  capability: 'skills.write' | 'instructions.write',
  tool: string,
  args: any,
  matcher: string,
  execute: () => Promise<any>,
) {
  const gate = await authorizeCapability(
    context,
    sessionId,
    capability,
    { tool, args },
    matcher,
    'HIGH',
  );
  if ('response' in gate) return gate.response;
  return gated(
    context,
    sessionId,
    { family: matcher, capability, risk: 'HIGH', argsHash: argsHash(args) },
    { tool, args },
    {},
    execute,
  );
}

export async function handleBasicTool(
  context: McpRuntimeContext,
  sessionId: string,
  name: string,
  args: any,
) {
  if (name === 'aevra_status') {
    const session = context.sessions.get(sessionId)!;
    const lease = context.sessions.activeLease(sessionId);
    const baselineCapabilities = lease?.capabilities ?? [];
    const summary = lease
      ? (context.deps.permissions?.summary({
          workspaceId: lease.workspaceId,
          actor: session.actor,
          sessionId,
          baselineCapabilities,
        }) ?? {
          effectiveCapabilities: [...baselineCapabilities],
          commandMatchers: [],
        })
      : { effectiveCapabilities: [], commandMatchers: [] };
    return {
      sessionId,
      workspace: lease
        ? (context.workspaces
            .listRemote()
            .find((workspace) => workspace.id === lease.workspaceId) ?? null)
        : null,
      baselineCapabilities: [...baselineCapabilities],
      effectiveCapabilities: summary.effectiveCapabilities,
      capabilities: summary.effectiveCapabilities,
      commandMatchers: summary.commandMatchers,
      execution: { default: 'sandbox', hostFallback: true },
    };
  }

  if (name === 'skills_list') {
    const gate = await authorizeRead(context, sessionId, 'skills.read', name, args, '*');
    if (gate && 'response' in gate) return gate.response;
    const all = context.deps.skills?.list(workspaceRoot(context, sessionId)) ?? [];
    const query = typeof args.query === 'string' && args.query ? args.query.toLowerCase() : null;
    const filtered = query
      ? all.filter(
          (skill) =>
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query),
        )
      : all;
    const offset = Math.max(0, Number(args.offset ?? 0) || 0);
    const limit = args.limit === undefined ? filtered.length : Math.max(0, Number(args.limit) || 0);
    return {
      skills: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
  }

  if (name === 'skill_read') {
    const source = args.source === 'workspace' ? 'workspace' : 'user';
    const skillName = String(args.name ?? '');
    const file = args.file ? String(args.file) : undefined;
    const matcher = `${source}:${skillName}:${file ?? 'SKILL.md'}`;
    const gate = await authorizeRead(context, sessionId, 'skills.read', name, args, matcher);
    if (gate && 'response' in gate) return gate.response;
    return (
      context.deps.skills?.read(source, skillName, workspaceRoot(context, sessionId), file) ??
      unavailable(name)
    );
  }

  if (name === 'skill_write') {
    const source = args.source === 'workspace' ? 'workspace' : 'user';
    const skillName = String(args.name ?? '');
    const file = args.file ? String(args.file) : undefined;
    const matcher = `${source}:${skillName}:${file ?? 'SKILL.md'}`;
    return authorizeWrite(context, sessionId, 'skills.write', name, args, matcher, async () => {
      if (!context.deps.skills) return unavailable(name);
      const result = context.deps.skills.write(
        source,
        skillName,
        workspaceRoot(context, sessionId),
        file,
        String(args.content ?? ''),
      );
      auditContextWrite(context, sessionId, 'skill_write', matcher);
      return result;
    });
  }

  if (name === 'instructions_read') {
    const gate = await authorizeRead(context, sessionId, 'instructions.read', name, args, '*');
    if (gate && 'response' in gate) return gate.response;
    return (
      context.deps.skills?.instructions(workspaceRoot(context, sessionId)) ?? {
        instructions: [],
        note: 'skills not configured',
      }
    );
  }

  if (name === 'instructions_write') {
    const source = args.source === 'workspace' ? 'workspace' : 'user';
    return authorizeWrite(
      context,
      sessionId,
      'instructions.write',
      name,
      args,
      source,
      async () => {
        if (!context.deps.skills) return unavailable(name);
        const result = context.deps.skills.writeInstructions(
          source,
          workspaceRoot(context, sessionId),
          String(args.content ?? ''),
        );
        auditContextWrite(context, sessionId, 'instructions_write', source);
        return result;
      },
    );
  }

  if (name === 'approval_status') {
    return context.approvals?.status(String(args.requestId)) ?? null;
  }
  if (name === 'approval_cancel') {
    return context.approvals?.cancel(String(args.requestId)) ?? null;
  }
  if (name === 'approval_wait') {
    const { resumeApproval } = await import('./approval-resume.js');
    return resumeApproval(context, sessionId, String(args.requestId));
  }

  if (name === 'workspace_list') return context.workspaces.listRemote();
  if (name === 'workspace_current') {
    const lease = context.sessions.activeLease(sessionId);
    return lease
      ? (context.workspaces.listRemote().find((workspace) => workspace.id === lease.workspaceId) ??
          null)
      : null;
  }
  return workspaceSelect(context, sessionId, args);
}

export function resourcesList(context: McpRuntimeContext, sessionId: string) {
  const skills = context.deps.skills?.list(workspaceRoot(context, sessionId)) ?? [];
  return {
    resources: skills.map((skill) => ({
      uri: `aevra://skill/${skill.source}/${encodeURIComponent(skill.name)}`,
      name: skill.name,
      description: skill.description || `Skill from ${skill.source} library`,
      mimeType: 'text/markdown',
    })),
  };
}

export async function resourceRead(context: McpRuntimeContext, sessionId: string, uri: string) {
  const match = String(uri).match(/^aevra:\/\/skill\/(user|workspace)\/([^/]+)$/);
  if (!match) {
    throw new AevraToolError('INVALID_REQUEST', 'Unknown resource URI');
  }
  const read = context.deps.skills?.read(
    match[1] as 'user' | 'workspace',
    decodeURIComponent(match[2]!),
    workspaceRoot(context, sessionId),
  );
  if (!read) {
    throw new AevraToolError('SKILL_NOT_FOUND', 'Skills are not configured');
  }
  return {
    uri,
    contents: [
      {
        uri,
        mimeType: 'text/markdown',
        text: read.content,
      },
    ],
  };
}

export function promptsList() {
  return {
    prompts: [
      {
        name: 'aevra-instructions',
        description: 'Merged AGENTS.md instructions (user global then active workspace)',
      },
    ],
  };
}

export async function promptGet(context: McpRuntimeContext, sessionId: string) {
  const result = context.deps.skills?.instructions(workspaceRoot(context, sessionId));
  if (!result) {
    throw new AevraToolError('INVALID_REQUEST', 'Skills are not configured');
  }
  const text =
    result.instructions
      .map((instruction) => `# ${instruction.source} instructions\n\n${instruction.content}`)
      .join('\n\n---\n\n') ||
    result.note ||
    'No instruction files found.';
  return {
    description: 'Aevra instructions',
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}
