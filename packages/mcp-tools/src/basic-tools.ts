import { workspaceSelect } from './authorization.js';
import { AevraToolError } from './errors.js';
import { unavailable, workspaceRoot } from './service-helpers.js';
import type { McpRuntimeContext } from './service-types.js';

export const BASIC_TOOL_NAMES = new Set([
  'aevra_status',
  'skills_list',
  'skill_read',
  'instructions_read',
  'approval_status',
  'approval_cancel',
  'approval_wait',
  'workspace_list',
  'workspace_current',
  'workspace_select',
]);

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
    const all =
      context.deps.skills?.list(workspaceRoot(context, sessionId)) ?? [];
    const query =
      typeof args.query === 'string' && args.query
        ? args.query.toLowerCase()
        : null;
    const filtered = query
      ? all.filter(
          (skill) =>
            skill.name.toLowerCase().includes(query) ||
            skill.description.toLowerCase().includes(query),
        )
      : all;
    const offset = Math.max(0, Number(args.offset ?? 0) || 0);
    const limit =
      args.limit === undefined
        ? filtered.length
        : Math.max(0, Number(args.limit) || 0);
    return {
      skills: filtered.slice(offset, offset + limit),
      total: filtered.length,
      offset,
      limit,
    };
  }

  if (name === 'skill_read') {
    return (
      context.deps.skills?.read(
        args.source === 'workspace' ? 'workspace' : 'user',
        String(args.name ?? ''),
        workspaceRoot(context, sessionId),
        args.file ? String(args.file) : undefined,
      ) ?? unavailable(name)
    );
  }

  if (name === 'instructions_read') {
    return (
      context.deps.skills?.instructions(workspaceRoot(context, sessionId)) ?? {
        instructions: [],
        note: 'skills not configured',
      }
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
      ? (context.workspaces
          .listRemote()
          .find((workspace) => workspace.id === lease.workspaceId) ?? null)
      : null;
  }
  return workspaceSelect(context, sessionId, args);
}

export function resourcesList(context: McpRuntimeContext, sessionId: string) {
  const skills =
    context.deps.skills?.list(workspaceRoot(context, sessionId)) ?? [];
  return {
    resources: skills.map((skill) => ({
      uri: `aevra://skill/${skill.source}/${encodeURIComponent(skill.name)}`,
      name: skill.name,
      description: skill.description || `Skill from ${skill.source} library`,
      mimeType: 'text/markdown',
    })),
  };
}

export async function resourceRead(
  context: McpRuntimeContext,
  sessionId: string,
  uri: string,
) {
  const match = String(uri).match(
    /^aevra:\/\/skill\/(user|workspace)\/([^/]+)$/,
  );
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
        description:
          'Merged AGENTS.md instructions (user global then active workspace)',
      },
    ],
  };
}

export async function promptGet(
  context: McpRuntimeContext,
  sessionId: string,
) {
  const result = context.deps.skills?.instructions(
    workspaceRoot(context, sessionId),
  );
  if (!result) {
    throw new AevraToolError(
      'INVALID_REQUEST',
      'Skills are not configured',
    );
  }
  const text =
    result.instructions
      .map(
        (instruction) =>
          `# ${instruction.source} instructions\n\n${instruction.content}`,
      )
      .join('\n\n---\n\n') ||
    result.note ||
    'No instruction files found.';
  return {
    description: 'Aevra instructions',
    messages: [{ role: 'user', content: { type: 'text', text } }],
  };
}
