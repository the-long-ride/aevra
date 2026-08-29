import { redactText } from '../../../../packages/security/src/dlp.js';
import { stripControlCharacters } from '../../../../packages/security/src/untrusted.js';
import type { FrozenOperationTicket } from './approval-service.js';

export interface ApprovalPresentation {
  title: string;
  action: string;
  target: string;
  preview?: string;
  /** True when the preview omits part of the text that will actually execute. */
  truncated?: boolean;
  /** Original character count, so a caller can state exactly how much is hidden. */
  previewFullLength?: number;
}

/**
 * Previews for text that executes verbatim get a far larger budget than labels.
 * A short cap is an approval-spoofing primitive: a benign prefix plus padding
 * pushes the real payload past the ellipsis where the approver cannot see it.
 */
const SCRIPT_PREVIEW_MAX = 4000;

function clean(value: unknown, max = 180) {
  let text = stripControlCharacters(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim();
  text = redactText(text).text;
  text = text.replace(/\b[A-Za-z0-9_-]{24,}\b/g, (token) =>
    /[A-Za-z]/.test(token) && /\d/.test(token) && /[-_]/.test(token) ? '[REDACTED]' : token,
  );
  if (text.length > max) text = `${text.slice(0, Math.max(0, max - 1))}…`;
  return text;
}

/** Builds a preview for text that will be executed, reporting anything it had to cut. */
function executablePreview(value: unknown) {
  const source = stripControlCharacters(String(value ?? ''));
  const preview = clean(source, SCRIPT_PREVIEW_MAX);
  return source.length > SCRIPT_PREVIEW_MAX
    ? { preview, truncated: true, previewFullLength: source.length }
    : { preview };
}

function commandPreview(command: any) {
  const executable = clean(command?.executable ?? '', 64),
    args = Array.isArray(command?.args) ? command.args.map((v: unknown) => clean(v, 512)) : [];
  return clean([executable, ...args].filter(Boolean).join(' '), SCRIPT_PREVIEW_MAX);
}
function executionTarget(mode: unknown) {
  return mode === 'host' ? 'Host workspace' : 'Strict sandbox';
}
function actorLabel(actor: unknown) {
  return (
    clean(String(actor ?? 'AI client').replace(/^(?:connector|oauth):/, ''), 80) || 'AI client'
  );
}
function originalIntent(original: any) {
  if (!original?.tool) return '';
  const args = original.args ?? {};
  if (['file_write', 'file_create', 'file_patch'].includes(original.tool))
    return `${original.tool.replace('file_', '')} ${clean(args.path ?? 'workspace file', 100)}`;
  if (original.tool === 'file_move')
    return `move ${clean(`${args.from ?? ''} → ${args.to ?? ''}`, 120)}`;
  if (original.tool === 'file_delete') return `delete ${clean(args.path ?? 'workspace path', 100)}`;
  if (original.tool === 'file_read') return `read ${clean(args.path ?? 'workspace file', 100)}`;
  if (original.tool === 'file_search') return `search ${clean(args.path ?? 'workspace', 100)}`;
  if (original.tool === 'command_run') {
    const command = args.command ?? { executable: args.executable, args: args.args };
    return `run ${commandPreview(command)}`;
  }
  if (original.tool === 'shell_run') return `run shell: ${clean(args.script ?? '', 120)}`;
  if (original.tool === 'git_commit') return `git commit: ${clean(args.message ?? '', 100)}`;
  if (original.tool === 'git_push')
    return `git push ${clean(`${args.remote ?? 'origin'}/${args.branch ?? 'current'}`, 100)}`;
  if (original.tool === 'process_start')
    return `start process ${commandPreview(args.command ?? args)}`;
  return clean(original.tool, 100);
}

export function presentApproval(ticket: FrozenOperationTicket): ApprovalPresentation {
  const family = String(ticket.operation?.family ?? ''),
    payload: any = ticket.payload ?? {},
    args: any = payload.args ?? {};
  if (family === 'workspace:select' || payload.tool === 'workspace_select')
    return {
      title: 'Workspace access',
      action: 'Read workspace',
      target: String(payload.workspaceId ?? ticket.workspaceId),
    };
  if (family === 'skills:read' || payload.tool === 'skills_access')
    return {
      title: 'Local skills access',
      action: 'Read local skills and instructions',
      target: 'User + active workspace',
    };
  if (
    family === 'workspace:capability-upgrade' ||
    payload.tool === 'workspace_capability_upgrade'
  ) {
    const added = Array.isArray(payload.addedCapabilities)
      ? payload.addedCapabilities
          .map((capability: unknown) => clean(capability, 80))
          .filter(Boolean)
      : [];
    return {
      title: 'Enable coding access',
      action: `Grant ${clean(payload.profileId || 'coding profile', 80)}`,
      target: String(payload.workspaceId ?? ticket.workspaceId),
      ...(added.length ? { preview: `Adds: ${clean(added.join(', '), 220)}` } : {}),
    };
  }
  if (payload.tool === 'capability_request') {
    const capability = String(payload.requestedCapability ?? ticket.operation.capability),
      matcher = String(payload.permissionMatcher ?? '*'),
      intent = originalIntent(payload.original),
      parts = [
        matcher !== '*' ? `Matcher: ${clean(matcher, 120)}` : '',
        intent ? `Requested by: ${intent}` : '',
      ].filter(Boolean);
    return {
      title: `${actorLabel(ticket.actor)} requests ${capability}`,
      action: `Grant ${capability}`,
      target: `Workspace ${clean(ticket.workspaceId, 120)}`,
      ...(parts.length ? { preview: clean(parts.join(' · '), 260) } : {}),
    };
  }
  if (payload.tool === 'file_delete' || family === 'files:delete')
    return {
      title: 'Delete workspace content',
      action: args.recursive ? 'Delete recursively' : 'Delete file',
      target: clean(args.path ?? payload.path ?? 'workspace path', 220),
    };
  if (payload.tool === 'file_write' || family === 'files:write')
    return {
      title: 'Edit workspace file',
      action: 'Write file',
      target: clean(args.path ?? payload.path ?? 'workspace path', 220),
    };
  if (payload.tool === 'file_patch')
    return {
      title: 'Edit workspace file',
      action: 'Patch file',
      target: clean(args.path ?? 'workspace path', 220),
    };
  if (payload.tool === 'file_move')
    return {
      title: 'Move workspace content',
      action: 'Move file or directory',
      target: clean(`${args.from ?? ''} → ${args.to ?? ''}`, 220),
    };
  if (payload.tool === 'git_push' || family === 'git:push')
    return {
      title: 'Git push',
      action: 'Git push',
      target: clean(`${args.remote ?? 'origin'}/${args.branch ?? 'current branch'}`, 180),
    };
  if (payload.tool === 'git_commit' || family === 'git:commit')
    return {
      title: 'Git commit',
      action: 'Create commit',
      target: 'Active workspace',
      preview: clean(args.message ?? '', 180),
    };
  if (payload.tool === 'change_rollback' || family === 'change:rollback')
    return {
      title: 'Rollback changes',
      action: 'Rollback change set',
      target: clean(args.changeSetId ?? 'change set', 180),
    };
  if (payload.tool === 'process_start')
    return {
      title: 'Start managed process',
      action: 'Start process',
      target: 'Active workspace',
      preview: commandPreview(args.command ?? args),
    };
  const command = args.command ?? payload.command;
  if (
    payload.sourceTool === 'shell_run' ||
    payload.tool === 'shell_run' ||
    family.startsWith('shell:')
  ) {
    const script = payload.script ?? (Array.isArray(command?.args) ? command.args.at(-1) : '');
    return {
      title: 'Run shell script',
      action: `Run ${clean(payload.shell || family.split(':')[1] || 'shell', 40)}`,
      target: executionTarget(args.executionMode ?? payload.executionMode),
      ...(script ? executablePreview(script) : {}),
    };
  }
  if (payload.tool === 'command_run' || command)
    return {
      title: 'Run command',
      action: 'Execute command',
      target: executionTarget(args.executionMode ?? payload.executionMode),
      preview: commandPreview(command),
    };
  return {
    title: 'Operation approval',
    action: clean(family || ticket.operation?.capability || 'Operation', 120),
    target: String(ticket.workspaceId || 'Aevra'),
  };
}
