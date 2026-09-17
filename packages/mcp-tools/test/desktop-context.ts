import { createHash } from 'node:crypto';
import type { DesktopWindowIdentity } from '../../../packages/protocol/src/desktop.js';

/**
 * Minimal runtime context for the desktop tool gate. The worker is a stub
 * that records what it was asked to do, so the tests measure tool-layer
 * policy and DLP decisions rather than real driver behaviour.
 *
 * The default window title is a deterministic sha256 hex digest of a fixed,
 * literal, non-secret fixture string - not `randomBytes(...).toString(...)`.
 * A base64url draw can legitimately begin or end with `-`, which is inside
 * the DLP blob regex's character class but not a `\b` word character, so on
 * roughly 3% of runs the match's edge could not anchor and the assertion
 * expecting an exact `'[REDACTED]'` would flake. A hex digest is 64
 * consistently-word characters with no such edge case, still high-entropy
 * (well above the redactor's 3.5 floor - verified against `redactText`
 * before relying on it here), and still not a secret-shaped literal: it is
 * the hash of a fixture string, not a plausible token or credential.
 */
const DETERMINISTIC_FIXTURE = createHash('sha256')
  .update('desktop-control-dlp-fixture')
  .digest('hex');

export function desktopContext(
  options: {
    title?: string;
    yolo?: boolean;
    leaseCapabilities?: string[];
    settingsPolicy?: unknown;
    apps?: unknown[];
  } = {},
) {
  const attackerTitle = options.title ?? DETERMINISTIC_FIXTURE;
  const window: DesktopWindowIdentity = {
    windowId: 'w1',
    processName: 'notepad.exe',
    title: attackerTitle,
  };
  const worker: any = {
    calls: [] as any[],
    execute: async (input: any) => {
      worker.calls.push(input);
      const kind = input.operation.kind;
      if (kind === 'desktop.status') return { ok: true, value: { connected: true } };
      if (kind === 'desktop.connect') return { ok: true, value: { connected: true } };
      if (kind === 'desktop.disconnect') return { ok: true, value: { connected: false } };
      if (kind === 'desktop.windows') return { ok: true, value: [window] };
      if (kind === 'desktop.apps') {
        return {
          ok: true,
          value: options.apps ?? [
            {
              displayName: 'Notepad Replacement',
              version: '2.3.1',
              executablePath: 'C:\\Program Files\\NotepadReplacement\\np.exe',
              exeBasename: 'np.exe',
            },
          ],
        };
      }
      if (kind === 'desktop.describe') {
        return {
          ok: true,
          value: {
            window,
            nodes: [
              {
                ref: 'ref_1_1',
                role: 'button',
                name: attackerTitle,
                value: attackerTitle,
                enabled: true,
                focused: false,
                children: [
                  { ref: 'ref_1_2', role: 'label', name: 'Child', enabled: true, focused: false },
                ],
              },
            ],
            truncated: false,
          },
        };
      }
      if (kind === 'desktop.capture') {
        return {
          ok: true,
          value: {
            imageDataUri: 'data:image/png;base64,AAAA',
            devicePixelRatio: 1,
            window: input.operation.windowId === 'no-window' ? null : window,
          },
        };
      }
      if (kind === 'desktop.act') {
        if (input.operation.ref === 'fail-ref') {
          return {
            ok: false,
            error: {
              code: 'DESKTOP_INPUT_REFUSED',
              message: 'refused by denylist',
              details: { window, gateVerdict: 'deny', gateRule: 'refused by denylist' },
            },
          };
        }
        return {
          ok: true,
          value: {
            focusChanged: false,
            newWindow: false,
            subtreeChanged: false,
            window,
            gateVerdict: 'allow',
            gateRule: 'permitted by denylist',
          },
        };
      }
      return { ok: true, value: { kind } };
    },
  };
  const audit = { events: [] as any[], append: (e: any) => void audit.events.push(e) };
  const approvals = {
    requests: [] as any[],
    request: async (req: any) => {
      approvals.requests.push(req);
      return { status: 'approval_pending' as const, requestId: 'r1' };
    },
  };
  return {
    worker,
    audit,
    auditEntries: audit.events,
    window,
    attackerTitle,
    approvals,
    value: {
      sessions: {
        get: () => ({ id: 's1', actor: 'oauth:ChatGPT', subject: 'subject' }),
        activeLease: () => ({
          workspaceId: 'w1',
          capabilities: options.leaseCapabilities ?? ['desktop.control'],
        }),
        isYolo: () => options.yolo === true,
      } as any,
      workspaces: { capabilityRoots: () => [] } as any,
      worker,
      reads: {} as any,
      approvals,
      deps: {
        audit,
        ...(options.settingsPolicy !== undefined
          ? { settings: { get: () => options.settingsPolicy } }
          : {}),
      } as any,
      oneTimeCapabilities: new Set<string>(),
      processStart: async () => ({}),
      callInner: async () => ({}),
    } as any,
  };
}
