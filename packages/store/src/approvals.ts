import type { DatabaseSync } from 'node:sqlite';
import { sanitizeStructuredSecrets } from '../../security/src/dlp.js';

export class ApprovalRepository {
  constructor(private db: DatabaseSync) {}
  put(t: any) {
    const now = new Date().toISOString();
    const payload = sanitizeStructuredSecrets(t.payload ?? null);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pending_approvals(id,actor,session_id,workspace_id,operation_json,expected_state_json,risk,state,expires_at,cancellation_reason,decision_scope,connection_subject,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        t.id,
        t.actor,
        t.sessionId,
        t.workspaceId,
        JSON.stringify({ normalized: t.operation, payload }),
        JSON.stringify(t.expectedState ?? {}),
        t.risk,
        t.state,
        t.expiresAt,
        t.cancellationReason ?? null,
        t.decisionScope ?? null,
        t.connectionSubject ?? t.connectionId ?? null,
        t.createdAt ?? now,
        now,
      );
    return { ...t, payload };
  }
  get(id: string) {
    const r = this.db.prepare('SELECT * FROM pending_approvals WHERE id=?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      actor: r.actor,
      sessionId: r.session_id,
      connectionId: r.connection_subject ?? undefined,
      connectionSubject: r.connection_subject ?? undefined,
      workspaceId: r.workspace_id,
      operation: (() => {
        const x = JSON.parse(r.operation_json);
        return x.normalized ?? x;
      })(),
      payload: (() => {
        const x = JSON.parse(r.operation_json);
        return x.payload ?? undefined;
      })(),
      expectedState: JSON.parse(r.expected_state_json),
      risk: r.risk,
      state: r.state,
      expiresAt: r.expires_at,
      cancellationReason: r.cancellation_reason,
      decisionScope: r.decision_scope,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
  list() {
    return (
      this.db.prepare('SELECT id FROM pending_approvals ORDER BY created_at DESC').all() as any[]
    ).map((r) => this.get(r.id));
  }

  claimExecution(id: string, nowIso: string): boolean {
    const res = this.db
      .prepare(
        "UPDATE pending_approvals SET state='EXECUTING', updated_at=? WHERE id=? AND state='APPROVED' AND expires_at>?",
      )
      .run(nowIso, id, nowIso);
    return Number(res.changes) === 1;
  }

  transitionExecution(
    id: string,
    state: 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED',
    nowIso: string,
  ): boolean {
    const res = this.db
      .prepare(
        "UPDATE pending_approvals SET state=?, updated_at=? WHERE id=? AND state='EXECUTING'",
      )
      .run(state, nowIso, id);
    return Number(res.changes) === 1;
  }

  transitionContextChanged(id: string, nowIso: string): boolean {
    const res = this.db
      .prepare(
        "UPDATE pending_approvals SET state='CONTEXT_CHANGED', updated_at=? WHERE id=? AND state='APPROVED'",
      )
      .run(nowIso, id);
    return Number(res.changes) === 1;
  }
}
