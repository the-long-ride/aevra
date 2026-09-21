import { analyzeCommand } from '../../../../../packages/command-analysis/src/index.js';
import type {
  AnalysisContext,
  CommandPolicyInput,
  CommandRequest,
} from '../../../../../packages/protocol/src/command-analysis.js';
import { decideCommand } from '../../policy/command-decision.js';
import { readAdminBody, sendAdminResponse } from './http.js';
import type { AdminRouteHandler } from './types.js';

export const handleCommandExplainRoutes: AdminRouteHandler = async (req, res, url, context) => {
  if (url.pathname !== '/api/policy/commands/explain') return false;
  if (req.method !== 'POST') return false;

  try {
    const input = await readAdminBody(req);
    const workspaceId = String(input.workspaceId ?? '');
    const script = typeof input.script === 'string' ? input.script : undefined;
    const command = input.command;
    const executable = String(input.executable ?? command?.executable ?? '');
    const rawArgs = Array.isArray(input.args)
      ? input.args.map(String)
      : Array.isArray(command?.args)
        ? command.args.map(String)
        : [];
    const argv = executable ? [executable, ...rawArgs] : rawArgs;
    const shell = input.shell;
    const cwdLogical = String(input.cwdLogical ?? command?.cwdLogical ?? '/');

    const request: CommandRequest = {
      kind: script !== undefined ? 'script' : 'argv',
      executable: executable || undefined,
      argv: argv.length > 0 ? argv : undefined,
      script,
      shell: shell as any,
      cwdLogical,
      env: input.env ?? {},
      executionMode: input.executionMode ?? 'host',
      networkDestinations: Array.isArray(input.networkDestinations)
        ? input.networkDestinations.map(String)
        : [],
    };

    const workspace = workspaceId ? context.workspaces?.getLocal?.(workspaceId) : null;
    if (workspaceId && !workspace) {
      sendAdminResponse(res, 404, {
        ok: false,
        error: `Workspace not found: ${workspaceId}`,
      });
      return true;
    }
    const hostRoot = workspace?.hostRoot;

    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
    if (sessionId && context.commandEvaluator) {
      const evaluated = await context.commandEvaluator({
        sessionId,
        workspaceId,
        request,
      });
      sendAdminResponse(res, 200, {
        ok: true,
        mode: 'runtime-session',
        request: evaluated.request ?? request,
        analysis: evaluated.analysis,
        decision: evaluated.decision,
      });
      return true;
    }

    const analysisContext: AnalysisContext = {
      actor: 'admin',
      sessionId: 'admin-explain',
      workspaceId,
      rootsRevision: '1',
      platform:
        process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',
      backendId: 'host',
      backendRevision: '1',
      policyRevision: '1',
      environmentFingerprint: 'explain',
      resolverGeneration: '1',
      workspaceRoot: hostRoot,
      roots: workspaceId ? (context.workspaces?.capabilityRoots?.(workspaceId) ?? []) : [],
    };

    const analysis = await analyzeCommand(request, analysisContext);

    const rawRules = (context.permissions?.list?.() ?? []) as any[];
    const rules = rawRules
      .filter(
        (r) =>
          r.capability === 'commands.run' &&
          (r.predicate_json || r.predicate) &&
          !(r.status === 'needs-review' && r.effect === 'allow'),
      )
      .map((r) => {
        let predicate;
        try {
          predicate =
            typeof r.predicate_json === 'string' ? JSON.parse(r.predicate_json) : r.predicate;
        } catch {
          return null;
        }
        if (!predicate) return null;
        return {
          id: r.id,
          effect: r.effect,
          predicate,
          scope: r.scope,
          actor: r.actor,
          workspaceId: r.workspace_id ?? r.workspaceId,
          sessionId: r.session_id ?? r.sessionId,
          expiresAt: r.expires_at ?? r.expiresAt,
        };
      })
      .filter(Boolean);

    const yoloSetting = context.settings?.get?.('policy.yolo', { mode: 'workspace' }) ?? {};
    const yoloActive =
      input.yoloActive !== undefined ? Boolean(input.yoloActive) : Boolean(yoloSetting.active);
    const yoloMode =
      input.yoloMode === 'unrestricted' || yoloSetting.mode === 'unrestricted'
        ? 'unrestricted'
        : 'workspace';

    const policyInput: CommandPolicyInput = {
      analysis,
      rules: rules as any,
      authority: { valid: true, commandCapability: true, reasons: [] },
      network: { outcome: 'allow', reasons: [] },
      yolo: {
        active: yoloActive,
        mode: yoloMode,
      },
      criticalAlwaysConfirm:
        input.criticalAlwaysConfirm !== undefined
          ? Boolean(input.criticalAlwaysConfirm)
          : Boolean(context.settings?.get?.('policy.critical.alwaysConfirm', false)),
      scriptTrust: 'not-applicable',
    };

    const decision = decideCommand(policyInput);

    sendAdminResponse(res, 200, {
      ok: true,
      mode: 'hypothetical-admin',
      assumptions: [
        'synthetic admin actor',
        'authority assumed valid',
        'network allowed unless requested otherwise',
      ],
      request,
      analysis,
      decision,
    });
    return true;
  } catch (error) {
    sendAdminResponse(res, (error as any)?.status ?? 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }
};
