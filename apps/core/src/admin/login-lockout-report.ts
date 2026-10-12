import { notifySystem } from '../../../../packages/notifications/src/notify.js';
import type { AuditService } from '../audit/audit-service.js';
import type { LoginLockoutEvent } from './login-throttle.js';

const NOTIFY_INTERVAL_MS = 60_000;

function describeLock(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return `${seconds}s`;
}

/**
 * Records every Admin login lockout in the audit log and raises a desktop
 * notification, at most one a minute so a distributed guess cannot flood the desktop.
 * Reporting is best-effort and never changes the login response.
 */
export function createLoginLockoutReporter(
  audit: Pick<AuditService, 'append'> | undefined,
  notify: (title: string, message: string) => void = notifySystem,
  now: () => number = Date.now,
): (event: LoginLockoutEvent) => void {
  let lastNotifiedAt = Number.NEGATIVE_INFINITY;
  return (event) => {
    try {
      audit?.append({
        operation: 'admin.login.lockout',
        target: event.scope,
        remoteIp: event.ip,
        decision: 'deny',
        result: `locked ${event.lockSeconds}s (level ${event.level})`,
        redactionCount: 0,
        class: 'security',
      });
    } catch {
      // An audit failure must not turn a rejected login into a server error.
    }
    if (now() - lastNotifiedAt < NOTIFY_INTERVAL_MS) return;
    lastNotifiedAt = now();
    notify(
      'Aevra: admin sign-in locked',
      `Locked for ${describeLock(event.lockSeconds)} after repeated failed sign-ins from ${event.ip}.`,
    );
  };
}
