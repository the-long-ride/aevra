import type { WorkerOperation, WorkerResult } from '../../../packages/protocol/src/worker.js';
import { browserRuntime } from './browser-runtime.js';

type BrowserOperation = Extract<WorkerOperation, { kind: `browser.${string}` }>;

/**
 * A `startsWith` check reads the same at runtime but narrows nothing, so the
 * dispatcher needs a real predicate to hand over a typed operation.
 */
export function isBrowserOperation(op: WorkerOperation): op is BrowserOperation {
  return op.kind.startsWith('browser.');
}

/**
 * Routes a `browser.*` envelope to the session registry. Kept out of the main
 * dispatcher because browser operations resolve no filesystem path and so must
 * not pay for capability-root resolution.
 *
 * Every page operation goes through `registry.run`, which holds the session
 * exclusively for its duration. Two concurrent `act` batches would otherwise
 * interleave their clicks on the same tab.
 */
export async function dispatchBrowserOperation(op: BrowserOperation): Promise<WorkerResult> {
  const registry = browserRuntime.registry();

  if (op.kind === 'browser.connect') {
    if (op.epoch !== undefined) await registry.setEpoch(op.epoch);
    if (op.extensionId) await browserRuntime.setExtensionId(op.extensionId);
    return {
      ok: true,
      value: await registry.connect({
        transport: op.transport,
        ...(op.cdpPort === undefined ? {} : { cdpPort: op.cdpPort }),
        ...(op.tabId === undefined ? {} : { tabId: op.tabId }),
      }),
    };
  }

  if (op.kind === 'browser.disconnect') {
    // Unconditional. `setEpoch` no longer implies a teardown - on an
    // uninitialised registry it adopts the value and returns - so a disconnect
    // carrying an epoch must still disconnect.
    if (op.epoch !== undefined) await registry.setEpoch(op.epoch);
    await registry.disconnect();
    return { ok: true, value: { disconnected: true, epoch: registry.epoch() } };
  }

  // Answered without a live driver: status must work precisely when nothing
  // is connected, which is when a caller most needs to ask.
  if (op.kind === 'browser.status') {
    // A status call is enough to sync a freshly started worker: the registry
    // adopts the first epoch it is told, and only then does the monotonic
    // guard apply.
    if (op.epoch !== undefined) await registry.setEpoch(op.epoch);
    if (op.extensionId) await browserRuntime.setExtensionId(op.extensionId);
    return { ok: true, value: await registry.status() };
  }

  if (op.kind === 'browser.tabs') {
    return {
      ok: true,
      value: await registry.run((driver) =>
        driver.tabs({ action: op.action, url: op.url, tabId: op.tabId }),
      ),
    };
  }
  if (op.kind === 'browser.navigate') {
    return {
      ok: true,
      value: await registry.run((driver) =>
        driver.navigate({ tabId: op.tabId, url: op.url, waitUntil: op.waitUntil }),
      ),
    };
  }
  if (op.kind === 'browser.snapshot') {
    return {
      ok: true,
      value: await registry.run((driver) =>
        driver.snapshot({ tabId: op.tabId, mode: op.mode, maxNodes: op.maxNodes }),
      ),
    };
  }
  if (op.kind === 'browser.read') {
    return {
      ok: true,
      value: await registry.run((driver) =>
        driver.read({
          tabId: op.tabId,
          ref: op.ref,
          selector: op.selector,
          format: op.format,
        }),
      ),
    };
  }
  if (op.kind === 'browser.act') {
    return {
      ok: true,
      value: await registry.run((driver) =>
        driver.act(op.actions, { tabId: op.tabId, stopOnError: op.stopOnError }),
      ),
    };
  }
  return {
    ok: true,
    value: await registry.run((driver) =>
      driver.logs({
        tabId: op.tabId,
        logKind: op.logKind,
        limit: op.limit,
        since: op.since,
      }),
    ),
  };
}
