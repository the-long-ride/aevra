import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Capability } from '../../../../packages/protocol/src/index.js';
import type { AdminApiContext } from './routes/api.js';

const CAPABILITIES = new Set<Capability>([
  'files.read',
  'files.search',
  'git.read',
  'files.write',
  'files.delete',
  'commands.run',
  'git.commit',
  'git.push',
  'network',
]);

function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > 1024 * 1024)
      throw Object.assign(new Error('request body too large'), { status: 413 });
    chunks.push(value);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}
function strings(value: unknown) {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .map(String)
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}
function bad(res: ServerResponse, message: string) {
  send(res, 400, { error: { code: 'INVALID_BULK_REQUEST', message } });
}
function isConnectorActor(actor: unknown) {
  const value = String(actor ?? '');
  return value.startsWith('connector:') || value.startsWith('oauth:');
}
function criticalPersistentRule(effect: string, matcher: string) {
  if (effect !== 'allow') return false;
  const value = matcher.toLowerCase();
  return /workspace[_:-]?escape|privilege|elevat|security:disable|git:(?:reset|clean|force-push)|git:push.*force/.test(
    value,
  );
}
function ruleKey(rule: any) {
  return [
    rule.effect,
    rule.capability,
    rule.scope,
    rule.workspaceId ?? '',
    rule.sessionId ?? '',
    rule.actor ?? '',
    rule.matcher,
  ].join('\u0000');
}

export async function handleBulkAdminAction(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  context: AdminApiContext,
  currentAdminSession?: string,
): Promise<boolean> {
  const path = url.pathname,
    method = req.method ?? 'GET';
  try {
    const isKnownMutation =
      (path === '/api/permissions/bulk' && method === 'POST') ||
      (path === '/api/audit' && method === 'DELETE') ||
      (path === '/api/sessions/revoke-others' && method === 'POST');
    if (isKnownMutation && context.safeMode?.()) {
      send(res, 503, {
        error: {
          code: 'SAFE_MODE',
          message: 'Administrative mutations are disabled while Aevra is in safe mode',
        },
      });
      return true;
    }
    if (path === '/api/permissions/bulk' && method === 'POST') {
      const input = await body(req),
        effect = input.effect === 'deny' ? 'deny' : 'allow',
        scope = String(input.scope ?? 'workspace');
      const capabilities = strings(input.capabilities).filter((value): value is Capability =>
        CAPABILITIES.has(value as Capability),
      );
      const actors = strings(input.actors);
      if (!capabilities.length) {
        bad(res, 'Select at least one capability');
        return true;
      }
      if (!actors.length) {
        bad(res, 'Select at least one connector');
        return true;
      }
      if (!['global', 'workspace', 'session'].includes(scope)) {
        bad(res, 'Scope must be global, workspace, or session');
        return true;
      }

      const newMatcherMode = Object.prototype.hasOwnProperty.call(input, 'commandMatchers');
      const legacyMatcher = String(input.matcher ?? '*').trim() || '*';
      const commandMatchers = newMatcherMode ? strings(input.commandMatchers) : [legacyMatcher];
      if (capabilities.includes('commands.run') && !commandMatchers.length) {
        bad(res, 'Select at least one command matcher');
        return true;
      }

      const createdAt = new Date().toISOString();
      const targets: Array<{ actor: string; workspaceId?: string; sessionId?: string }> = [];
      if (scope === 'global') {
        for (const actor of actors) targets.push({ actor });
      } else if (scope === 'workspace') {
        const workspaceIds = strings(input.workspaceIds);
        if (!workspaceIds.length) {
          bad(res, 'Select at least one workspace');
          return true;
        }
        const existing = new Set(
          (context.workspaces?.listRemote?.() ?? context.workspaces?.listLocal?.() ?? []).map(
            (item: any) => String(item.id),
          ),
        );
        const invalid = workspaceIds.find((id) => !existing.has(id));
        if (invalid) {
          bad(res, `Unknown workspace: ${invalid}`);
          return true;
        }
        for (const actor of actors)
          for (const workspaceId of workspaceIds) targets.push({ actor, workspaceId });
      } else {
        const sessionIds = strings(input.sessionIds);
        if (!sessionIds.length) {
          bad(res, 'Select at least one session');
          return true;
        }
        const sessions = (context.sessions?.list?.() ?? []) as any[];
        for (const sessionId of sessionIds) {
          const session = sessions.find((item) => item.id === sessionId);
          if (!session) {
            bad(res, `Unknown session: ${sessionId}`);
            return true;
          }
          if (!actors.includes(String(session.actor))) {
            bad(res, `Session ${sessionId} is not owned by a selected connector`);
            return true;
          }
          targets.push({ actor: String(session.actor), sessionId });
        }
      }

      const expanded: any[] = [];
      for (const target of targets) {
        for (const capability of capabilities) {
          const matchers =
            capability === 'commands.run'
              ? commandMatchers
              : [newMatcherMode ? '*' : legacyMatcher];
          for (const matcher of matchers) {
            if (criticalPersistentRule(effect, matcher)) {
              send(res, 400, {
                error: {
                  code: 'CRITICAL_RULE_FORBIDDEN',
                  message: 'Critical operations cannot receive persistent always-allow rules',
                },
              });
              return true;
            }
            expanded.push({
              id: `perm_${randomUUID()}`,
              effect,
              capability,
              scope,
              ...target,
              matcher,
              createdAt,
            });
          }
        }
      }
      const seen = new Set<string>(),
        created = expanded.filter((rule) => {
          const key = ruleKey(rule);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (context.permissions?.upsertMany) context.permissions.upsertMany(created);
      else for (const rule of created) context.permissions?.upsert?.(rule);
      send(res, 201, { ok: true, count: created.length, rules: created });
      return true;
    }
    const admissionMatch = path.match(/^\/api\/workspaces\/([^/]+)\/admissions$/);
    if (admissionMatch && method === 'GET') {
      send(res, 200, context.profiles?.listMappings?.(decodeURIComponent(admissionMatch[1])) ?? []);
      return true;
    }
    if (path === '/api/audit' && method === 'DELETE') {
      const removed = context.audit?.clear?.() ?? 0;
      send(res, 200, { ok: true, removed });
      return true;
    }
    if (path === '/api/sessions/revoke-others' && method === 'POST') {
      const remote = (context.sessions?.list?.() ?? []) as any[];
      let revokedRemote = 0,
        preservedConnectors = 0;
      for (const session of remote) {
        if (isConnectorActor(session.actor)) {
          preservedConnectors++;
          continue;
        }
        context.sessions?.revoke?.(session.id);
        revokedRemote++;
      }
      const adminResult = context.bootstrap?.revokeAllExcept?.(currentAdminSession) ?? {
        revoked: 0,
        preserved: 0,
      };
      send(res, 200, {
        ok: true,
        revokedRemote,
        preservedConnectors,
        revokedAdmin: adminResult.revoked,
        preservedAdmin: adminResult.preserved,
      });
      return true;
    }
    return false;
  } catch (error) {
    const value = error as any;
    send(res, value?.status ?? 400, {
      error: {
        code: value?.code ?? 'ADMIN_BULK_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    return true;
  }
}
