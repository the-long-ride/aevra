import { createHash } from 'node:crypto';
import type {
  DesktopCaptureResult,
  DesktopDescribeResult,
  DesktopReadPolicy,
  DesktopPolicy,
  DesktopWindowIdentity,
} from '../../protocol/src/desktop.js';
import type { RiskTier } from '../../protocol/src/index.js';
import type { WorkerOperation } from '../../protocol/src/worker.js';
import { markUntrusted } from '../../security/src/untrusted.js';
import { evaluateWindowGate, evaluateDesktopTargetGate } from '../../security/src/window-gate.js';
import { gatedHostControl } from './host-control-gate.js';
import { argsHash } from './service-helpers.js';
import {
  audit,
  policyFor,
  redactNode,
  redactWindow,
  run,
  sanitizeDesktopToolError,
  targetOf,
} from './desktop-support.js';
import { AevraToolError } from './errors.js';
import type { McpRuntimeContext } from './service-types.js';

export async function handleDescribe(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
  risk: RiskTier,
) {
  const mode = args.mode === 'background' ? 'background' : 'foreground';
  const policy = policyFor(context, sessionId);
  const operation: WorkerOperation = {
    kind: 'desktop.describe',
    ...(args.windowId !== undefined ? { windowId: String(args.windowId) } : {}),
    maxNodes: Number(args.maxNodes ?? 500),
    interactiveOnly: Boolean(args.interactiveOnly ?? false),
    mode,
    policy,
  };
  let value: DesktopDescribeResult;
  try {
    value = (await run(context, sessionId, operation)) as DesktopDescribeResult;
  } catch (error) {
    throw sanitizeDesktopToolError(context, sessionId, error);
  }
  const tally = { count: 0 };
  const window = redactWindow(value.window, tally, policy);
  const nodes = value.nodes.map((node) => redactNode(node, tally));
  // Recheck the worker-observed identity before returning accessibility data.
  const verdict = readVerdict(
    value.window,
    value.readPolicy,
    policy,
    sessionId,
    mode === 'background' ? 'background' : 'capture',
  );
  if (!verdict.allowed)
    throw new AevraToolError('DESKTOP_INPUT_REFUSED', 'Desktop read target is protected');
  audit(context, sessionId, 'desktop_describe', targetOf(window), risk, 'SUCCEEDED', {
    redactionCount: tally.count,
    gateVerdict: verdict.allowed ? 'allow' : 'deny',
    gateRule: verdict.reason,
  });
  return markUntrusted({
    window,
    nodes,
    truncated: value.truncated,
    ...(value.snapshotId ? { snapshotId: value.snapshotId } : {}),
    ...(value.windowLeaseId ? { windowLeaseId: value.windowLeaseId } : {}),
    ...(value.leaseExpiresAt ? { leaseExpiresAt: value.leaseExpiresAt } : {}),
  });
}

export async function handleCapture(
  context: McpRuntimeContext,
  sessionId: string,
  args: any,
  risk: RiskTier,
) {
  const operation: WorkerOperation = {
    kind: 'desktop.capture',
    policy: policyFor(context, sessionId),
    ...(args.windowId !== undefined ? { windowId: String(args.windowId) } : {}),
  };
  if (!args.windowId)
    return gatedHostControl(
      context,
      sessionId,
      {
        family: 'desktop:capture',
        capability: 'desktop.control',
        risk: 'HIGH',
        argsHash: argsHash(args),
      },
      { tool: 'desktop_capture', args },
      () => captureResult(context, sessionId, operation, risk),
    );
  return captureResult(context, sessionId, operation, risk);
}

async function captureResult(
  context: McpRuntimeContext,
  sessionId: string,
  operation: Extract<WorkerOperation, { kind: 'desktop.capture' }>,
  risk: RiskTier,
) {
  const value = (await run(context, sessionId, operation)) as DesktopCaptureResult;
  const policy = policyFor(context, sessionId);
  const tally = { count: 0 };
  const window = value.window ? redactWindow(value.window, tally, policy) : null;
  // Gate the raw identity; redaction must not hide a protected title.
  const verdict = value.window
    ? readVerdict(value.window, value.readPolicy, policy, sessionId, 'capture')
    : {
        allowed:
          !operation.windowId &&
          value.readPolicy?.scope === 'screen' &&
          value.readPolicy.targets.length > 0 &&
          value.readPolicy.targets.every(
            (target) => evaluateDesktopTargetGate(target, policy, 'capture', sessionId).allowed,
          ),
        reason: 'worker checked full-screen targets',
      };
  if (!verdict.allowed)
    throw new AevraToolError('DESKTOP_INPUT_REFUSED', 'Desktop capture target is protected');
  // Screenshots are pixels and cannot be DLP-redacted, so the audit log
  // records a content hash of the image, never `imageDataUri` itself.
  const evidence = `${targetOf(window)} sha256:${createHash('sha256')
    .update(String(value.imageDataUri))
    .digest('hex')}`;
  audit(context, sessionId, 'desktop_capture', evidence, risk, 'SUCCEEDED', {
    redactionCount: tally.count,
    gateVerdict: verdict.allowed ? 'allow' : 'deny',
    gateRule: verdict.reason,
  });
  return markUntrusted({
    imageDataUri: value.imageDataUri,
    devicePixelRatio: value.devicePixelRatio,
    window,
  });
}

function readVerdict(
  window: DesktopWindowIdentity,
  evidence: DesktopReadPolicy | undefined,
  policy: DesktopPolicy,
  sessionId: string,
  direction: 'capture' | 'background',
) {
  const target = evidence?.targets.find((item) => item.window.windowId === window.windowId);
  return target
    ? evaluateDesktopTargetGate({ ...target, window }, policy, direction, sessionId)
    : evaluateWindowGate(window, policy, direction);
}
